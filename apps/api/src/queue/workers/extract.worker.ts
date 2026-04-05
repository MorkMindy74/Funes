import { Worker } from "bullmq"
import { eq } from "drizzle-orm"
import { redisConnection } from "../connection.js"
import { chunkQueue, type ExtractJobData } from "../queues.js"
import { db } from "../../db/index.js"
import { documents } from "../../db/schema.js"
import { getExtractor } from "../../processing/extractors/index.js"
import { env } from "../../env.js"
import { logger } from "../../logger.js"

export const extractWorker = new Worker<ExtractJobData>(
	"extract",
	async (job) => {
		const { documentId } = job.data
		logger.info({ documentId, jobId: job.id }, "ExtractWorker: starting")

		// Fetch document
		const [doc] = await db
			.select()
			.from(documents)
			.where(eq(documents.id, documentId))
			.limit(1)

		if (!doc) throw new Error(`Document ${documentId} not found`)

		// Update status → extracting
		await db
			.update(documents)
			.set({ status: "extracting", updatedAt: new Date() })
			.where(eq(documents.id, documentId))

		try {
			// Get appropriate extractor (default: MarkItDown)
			const extractor = await getExtractor(undefined, {
				firecrawlUrl: env.FIRECRAWL_URL || undefined,
				ocrProvider: env.OCR_PROVIDER || undefined,
			})

			// Extract content to markdown
			const content = doc.content ?? ""
			const result = await extractor.extract(content)

			// Update document with extracted content
			const wordCount = result.markdown.split(/\s+/).length
			const tokenCount = Math.ceil(wordCount * 1.3)

			await db
				.update(documents)
				.set({
					content: result.markdown,
					title: result.title ?? doc.title,
					type: result.sourceType ?? doc.type,
					tokenCount,
					wordCount,
					status: "chunking",
					updatedAt: new Date(),
				})
				.where(eq(documents.id, documentId))

			// Enqueue chunking
			await chunkQueue.add("chunk", { documentId })

			logger.info(
				{ documentId, words: wordCount, extractor: extractor.name },
				"ExtractWorker: done",
			)
		} catch (err) {
			logger.error({ documentId, err }, "ExtractWorker: failed")
			await db
				.update(documents)
				.set({
					status: "failed",
					processingMetadata: {
						error: err instanceof Error ? err.message : String(err),
						steps: [
							{
								name: "extract",
								startTime: Date.now(),
								status: "failed",
								error: err instanceof Error ? err.message : String(err),
							},
						],
					},
					updatedAt: new Date(),
				})
				.where(eq(documents.id, documentId))
			throw err
		}
	},
	{
		connection: redisConnection,
		concurrency: 3,
	},
)
