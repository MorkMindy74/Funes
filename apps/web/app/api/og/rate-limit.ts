const WINDOW_MS = 60_000 // 1 minute
const MAX_REQUESTS = 30

interface RateLimitEntry {
	count: number
	resetAt: number
}

const ipRequests = new Map<string, RateLimitEntry>()

// Cleanup stale entries every 60 seconds
setInterval(() => {
	const now = Date.now()
	for (const [ip, entry] of ipRequests) {
		if (now > entry.resetAt) {
			ipRequests.delete(ip)
		}
	}
}, WINDOW_MS)

export function checkRateLimit(ip: string): {
	allowed: boolean
	retryAfter: number
} {
	const now = Date.now()
	const entry = ipRequests.get(ip)

	if (!entry || now > entry.resetAt) {
		ipRequests.set(ip, { count: 1, resetAt: now + WINDOW_MS })
		return { allowed: true, retryAfter: 0 }
	}

	if (entry.count >= MAX_REQUESTS) {
		const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
		return { allowed: false, retryAfter }
	}

	entry.count++
	return { allowed: true, retryAfter: 0 }
}
