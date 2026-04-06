/**
 * Structured logger for Supermemory services.
 *
 * Uses JSON format for structured logging with support for correlation IDs.
 * Compatible with both Node.js and Cloudflare Workers runtimes.
 */

type LogLevel = "debug" | "info" | "warn" | "error"

interface LogEntry {
	level: LogLevel
	service: string
	message: string
	correlationId?: string
	timestamp: string
	[key: string]: unknown
}

interface LoggerOptions {
	correlationId?: string
}

interface Logger {
	debug(message: string, data?: Record<string, unknown>): void
	info(message: string, data?: Record<string, unknown>): void
	warn(message: string, data?: Record<string, unknown>): void
	error(message: string, data?: Record<string, unknown>): void
	child(options: LoggerOptions): Logger
}

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
}

function getMinLevel(): number {
	const env = typeof process !== "undefined" ? process.env?.NODE_ENV : undefined
	return env === "production" ? LOG_LEVELS.info : LOG_LEVELS.debug
}

function formatEntry(entry: LogEntry): string {
	return JSON.stringify(entry)
}

function createLogMethod(
	level: LogLevel,
	service: string,
	correlationId?: string,
) {
	const minLevel = getMinLevel()
	return (message: string, data?: Record<string, unknown>) => {
		if (LOG_LEVELS[level] < minLevel) return

		const entry: LogEntry = {
			level,
			service,
			message,
			timestamp: new Date().toISOString(),
			...(correlationId && { correlationId }),
			...data,
		}

		const formatted = formatEntry(entry)

		switch (level) {
			case "error":
				console.error(formatted)
				break
			case "warn":
				console.warn(formatted)
				break
			case "debug":
				console.debug(formatted)
				break
			default:
				console.log(formatted)
		}
	}
}

/**
 * Create a structured logger instance.
 *
 * @param name - Service name (e.g. "mcp-auth", "web-middleware")
 * @param options - Optional configuration including correlationId
 */
export function createLogger(name: string, options?: LoggerOptions): Logger {
	const correlationId = options?.correlationId

	const logger: Logger = {
		debug: createLogMethod("debug", name, correlationId),
		info: createLogMethod("info", name, correlationId),
		warn: createLogMethod("warn", name, correlationId),
		error: createLogMethod("error", name, correlationId),
		child(childOptions: LoggerOptions): Logger {
			return createLogger(name, {
				correlationId: childOptions.correlationId ?? correlationId,
			})
		},
	}

	return logger
}
