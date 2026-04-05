import { Queue } from "bullmq"
import { redisConnection } from "./connection.js"

/** Document extraction queue — converts raw content to markdown */
export const extractQueue = new Queue("extract", {
	connection: redisConnection,
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: "exponential", delay: 2000 },
		removeOnComplete: { count: 1000 },
		removeOnFail: { count: 5000 },
	},
})

/** Chunking queue — splits markdown into semantic chunks */
export const chunkQueue = new Queue("chunk", {
	connection: redisConnection,
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: "exponential", delay: 1000 },
		removeOnComplete: { count: 1000 },
		removeOnFail: { count: 5000 },
	},
})

/** Embedding queue — generates vector embeddings for chunks */
export const embedQueue = new Queue("embed", {
	connection: redisConnection,
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: "exponential", delay: 2000 },
		removeOnComplete: { count: 1000 },
		removeOnFail: { count: 5000 },
	},
})

/** Indexing queue — writes embeddings to LanceDB */
export const indexQueue = new Queue("index", {
	connection: redisConnection,
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: "exponential", delay: 1000 },
		removeOnComplete: { count: 1000 },
		removeOnFail: { count: 5000 },
	},
})

export type ExtractJobData = { documentId: string }
export type ChunkJobData = { documentId: string }
export type EmbedJobData = { documentId: string }
export type IndexJobData = { documentId: string }
