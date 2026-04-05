import { Worker } from "bullmq"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { redisConnection } from "../connection.js"
import { embedQueue, type ChunkJobData } from "../queues.js"
import { db } from "../../db/index.js"
import { documents, chunks } from "../../db/schema.js"
import { chunkContent } from "../../processing/chunker.js"
import { logger } from "../../logger.js"

export const chunkWorker = new Worker<ChunkJobData>(
	"chunk",
	async (job) => {
		const { documentId } = job.data
		logger.info({ documentId, jobId: job.id }, "ChunkWorker: starting")

		// Fetch document
		const [doc] = await db
			.select()
			.from(documents)
			.where(eq(documents.id, documentId))
			.limit(1)

		if (!doc) throw new Error(`Document ${documentId} not found`)
		if (!doc.content) throw new Error(`Document ${documentId} has no content`)

		try {
			// Chunk the content
			const chunkResults = chunkContent(doc.content)

			if (chunkResults.length === 0) {
				logger.warn({ documentId }, "ChunkWorker: no chunks produced")
				// Still proceed — mark as done with 0 chunks
			}

			// Delete existing chunks for this document (in case of reprocessing)
			await db.delete(chunks).where(eq(chunks.documentId, documentId))

			// Insert chunks in batch
			if (chunkResults.length > 0) {
				await db.insert(chunks).values(
					chunkResults.map((chunk) => ({
						id: nanoid(),
						documentId,
						content: chunk.content,
						type: chunk.type,
						position: chunk.position,
						metadata: chunk.metadata ?? null,
						createdAt: new Date(),
					})),
				)
			}

			// Compute average chunk size
			const totalChars = chunkResults.reduce((sum, c) => sum + c.content.length, 0)
			const avgChunkSize =
				chunkResults.length > 0
					? Math.round(totalChars / chunkResults.length)
					: 0

			// Update document
			await db
				.update(documents)
				.set({
					chunkCount: chunkResults.length,
					averageChunkSize: avgChunkSize,
					status: "embedding",
					updatedAt: new Date(),
				})
				.where(eq(documents.id, documentId))

			// Enqueue embedding
			await embedQueue.add("embed", { documentId })

			logger.info(
				{ documentId, chunks: chunkResults.length, avgSize: avgChunkSize },
				"ChunkWorker: done",
			)
		} catch (err) {
			logger.error({ documentId, err }, "ChunkWorker: failed")
			await db
				.update(documents)
				.set({ status: "failed", updatedAt: new Date() })
				.where(eq(documents.id, documentId))
			throw err
		}
	},
	{
		connection: redisConnection,
		concurrency: 5,
	},
)
