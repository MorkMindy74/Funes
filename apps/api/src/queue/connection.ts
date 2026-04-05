import IORedis from "ioredis"
import { env } from "../env.js"
import { logger } from "../logger.js"

/** Shared Redis connection for BullMQ queues and workers */
export const redisConnection = new (IORedis as any).default(env.REDIS_URL, {
	maxRetriesPerRequest: null, // Required by BullMQ
	enableReadyCheck: false,
	lazyConnect: true,
}) as InstanceType<typeof IORedis.default>

redisConnection.on("error", (err: Error) => {
	logger.warn({ err: err.message }, "Redis connection error (queue features disabled)")
})

redisConnection.on("connect", () => {
	logger.info("Redis connected — BullMQ queues active")
})

/** Check if Redis is available */
export async function isRedisAvailable(): Promise<boolean> {
	try {
		await redisConnection.connect()
		await redisConnection.ping()
		return true
	} catch {
		return false
	}
}
