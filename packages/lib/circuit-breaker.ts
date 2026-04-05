/**
 * Simple circuit breaker for external service calls.
 *
 * Prevents cascading failures by tracking errors and temporarily
 * short-circuiting requests to failing services.
 */

import { createLogger } from "./logger"

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN"

export class CircuitBreakerOpenError extends Error {
	constructor(name: string) {
		super(`Circuit breaker "${name}" is open — request rejected`)
		this.name = "CircuitBreakerOpenError"
	}
}

interface CircuitBreakerOptions {
	/** Number of consecutive failures before opening the circuit */
	failureThreshold?: number
	/** Time in ms to wait before probing with a test request */
	resetTimeout?: number
	/** Name for logging */
	name: string
}

export class CircuitBreaker {
	private state: CircuitState = "CLOSED"
	private failureCount = 0
	private lastFailureTime = 0
	private readonly failureThreshold: number
	private readonly resetTimeout: number
	private readonly name: string
	private readonly logger: ReturnType<typeof createLogger>

	constructor(options: CircuitBreakerOptions) {
		this.failureThreshold = options.failureThreshold ?? 5
		this.resetTimeout = options.resetTimeout ?? 30_000
		this.name = options.name
		this.logger = createLogger(`circuit-breaker:${this.name}`)
	}

	async execute<T>(fn: () => Promise<T>): Promise<T> {
		if (this.state === "OPEN") {
			if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
				this.state = "HALF_OPEN"
				this.logger.info("Transitioning to HALF_OPEN, allowing probe request")
			} else {
				throw new CircuitBreakerOpenError(this.name)
			}
		}

		try {
			const result = await fn()
			this.onSuccess()
			return result
		} catch (error) {
			this.onFailure()
			throw error
		}
	}

	private onSuccess(): void {
		if (this.state === "HALF_OPEN") {
			this.logger.info("Probe succeeded, transitioning to CLOSED")
		}
		this.failureCount = 0
		this.state = "CLOSED"
	}

	private onFailure(): void {
		this.failureCount++
		this.lastFailureTime = Date.now()

		if (this.failureCount >= this.failureThreshold) {
			this.state = "OPEN"
			this.logger.error("Failure threshold reached, transitioning to OPEN", {
				failureCount: this.failureCount,
			})
		}
	}

	getState(): CircuitState {
		return this.state
	}
}
