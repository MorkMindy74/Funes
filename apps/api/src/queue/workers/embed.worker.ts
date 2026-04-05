import { Worker } from "bullmq"
import { eq } from "drizzle-orm"
import { redisConnection } from "../connection.js"
import { indexQueue, type EmbedJobData } from "../queues.js"
import { db } from "../../db/index.js"
import { documents, chunks } from "../../db/schema.js"
import {
	generateEmbeddings,
	generateEmbedding,
	getEmbeddingModelName,
} from "../../processing/embeddings.js"
import { logger } from "../../logger.js"

export const embedWorker = new Worker<EmbedJobData>(
	"embed",
	async (job) => {
		const { documentId } = job.data
		logger.info({ documentId, jobId: job.id }, "EmbedWorker: starting")

		// Fetch document and its chunks
		const [doc] = await db
			.select()
			.from(documents)
			.where(eq(documents.id, documentId))
			.limit(1)

		if (!doc) throw new Error(`Document ${documentId} not found`)

		const docChunks = await db
			.select()
			.from(chunks)
			.where(eq(chunks.documentId, documentId))
			.orderBy(chunks.position)

		try {
			const modelName = getEmbeddingModelName()

			// Generate embeddings for all chunks
			if (docChunks.length > 0) {
				const texts = docChunks.map((c) => c.content)
				const embeddings = await generateEmbeddings(texts)

				// Update each chunk with its embedding
				for (let i = 0; i < docChunks.length; i++) {
					await db
						.update(chunks)
						.set({
							embedding: embeddings[i],
							embeddingModel: modelName,
						})
						.where(eq(chunks.id, docChunks[i].id))
				}
			}

			// Generate summary embedding (from title + summary or first chunk)
			const summaryText =
				[doc.title, doc.summary].filter(Boolean).join(" — ") ||
				docChunks[0]?.content?.slice(0, 500) ||
				doc.content?.slice(0, 500) ||
				""

			if (summaryText) {
				const summaryEmb = await generateEmbedding(summaryText)
				await db
					.update(documents)
					.set({
						summaryEmbedding: summaryEmb,
						summaryEmbeddingModel: modelName,
						status: "indexing",
						updatedAt: new Date(),
					})
					.where(eq(documents.id, documentId))
			} else {
				await db
					.update(documents)
					.set({ status: "indexing", updatedAt: new Date() })
					.where(eq(documents.id, documentId))
			}

			// Enqueue indexing
			await indexQueue.add("index", { documentId })

			logger.info(
				{ documentId, chunks: docChunks.length, model: modelName },
				"EmbedWorker: done",
			)
		} catch (err) {
			logger.error({ documentId, err }, "EmbedWorker: failed")
			await db
				.update(documents)
				.set({ status: "failed", updatedAt: new Date() })
				.where(eq(documents.id, documentId))
			throw err
		}
	},
	{
		connection: redisConnection,
		concurrency: 2, // Embedding is CPU-intensive
	},
)
