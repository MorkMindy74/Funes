import { Worker } from "bullmq"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { redisConnection } from "../connection.js"
import type { IndexJobData } from "../queues.js"
import { db } from "../../db/index.js"
import {
	documents,
	chunks,
	spaces,
	memoryEntries,
	memoryDocumentSources,
	documentsToSpaces,
} from "../../db/schema.js"
import { indexChunks, indexMemories } from "../../vector/lancedb.js"
import { extractMemories } from "../../processing/memory-extractor.js"
import { generateEmbedding, getEmbeddingModelName } from "../../processing/embeddings.js"
import { logger } from "../../logger.js"

export const indexWorker = new Worker<IndexJobData>(
	"index",
	async (job) => {
		const { documentId } = job.data
		logger.info({ documentId, jobId: job.id }, "IndexWorker: starting")

		// Fetch document and chunks with embeddings
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
			// 1. Index chunks in LanceDB
			const chunksWithEmbeddings = docChunks
				.filter((c) => c.embedding != null)
				.map((c) => ({
					id: c.id,
					documentId: c.documentId,
					content: c.content,
					embedding: c.embedding!,
				}))

			await indexChunks(chunksWithEmbeddings)

			// 2. Extract memories from content
			const memories = await extractMemories(doc.content ?? "", {
				title: doc.title ?? undefined,
				url: doc.url ?? undefined,
			})

			// 3. Find the space(s) for this document
			const docSpaces = await db
				.select({ spaceId: documentsToSpaces.spaceId })
				.from(documentsToSpaces)
				.where(eq(documentsToSpaces.documentId, documentId))

			const spaceId = docSpaces[0]?.spaceId

			// 4. Create memory entries and index them
			if (memories.length > 0 && spaceId) {
				const modelName = getEmbeddingModelName()

				for (const mem of memories) {
					const memId = nanoid()
					const memEmbedding = await generateEmbedding(mem.memory)

					// Insert memory entry
					await db.insert(memoryEntries).values({
						id: memId,
						memory: mem.memory,
						spaceId,
						orgId: doc.orgId,
						userId: doc.userId,
						confidence: mem.confidence,
						memoryLevel: mem.level,
						isStatic: mem.isStatic,
						memoryEmbedding: memEmbedding,
						memoryEmbeddingModel: modelName,
						metadata: mem.metadata ?? null,
						createdAt: new Date(),
						updatedAt: new Date(),
					})

					// Link memory to document
					await db.insert(memoryDocumentSources).values({
						memoryEntryId: memId,
						documentId,
						relevanceScore: mem.confidence * 100,
						addedAt: new Date(),
					})

					// Index in LanceDB
					await indexMemories([
						{
							id: memId,
							memory: mem.memory,
							spaceId,
							embedding: memEmbedding,
						},
					])
				}
			}

			// 5. Mark document as done
			await db
				.update(documents)
				.set({
					status: "done",
					processingMetadata: {
						finalStatus: "done",
						endTime: Date.now(),
						steps: [],
					},
					updatedAt: new Date(),
				})
				.where(eq(documents.id, documentId))

			logger.info(
				{
					documentId,
					indexedChunks: chunksWithEmbeddings.length,
					memories: memories.length,
				},
				"IndexWorker: done — document fully processed",
			)
		} catch (err) {
			logger.error({ documentId, err }, "IndexWorker: failed")
			await db
				.update(documents)
				.set({ status: "failed", updatedAt: new Date() })
				.where(eq(documents.id, documentId))
			throw err
		}
	},
	{
		connection: redisConnection,
		concurrency: 3,
	},
)
