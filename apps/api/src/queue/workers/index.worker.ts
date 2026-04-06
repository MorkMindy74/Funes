import { Worker } from "bullmq"
import { eq } from "drizzle-orm"
import { redisConnection } from "../connection.js"
import type { IndexJobData } from "../queues.js"
import { db } from "../../db/index.js"
import { documents, chunks, documentsToSpaces } from "../../db/schema.js"
import { indexChunks } from "../../vector/index.js"
import { extractMemories } from "../../processing/memory-extractor.js"
import { consolidateOrCreate } from "../../processing/memory-manager.js"
import { extractGraphWithCustomPrompt } from "../../processing/entity-extractor.js"
import { ingestGraph } from "../../processing/graph-manager.js"
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

			// 4. Create or consolidate memory entries (EverMemOS pattern)
			if (memories.length > 0 && spaceId) {
				let created = 0
				let consolidated = 0

				for (const mem of memories) {
					try {
						const memId = await consolidateOrCreate(
							mem,
							spaceId,
							doc.orgId,
							doc.userId,
							documentId,
						)
						// If the returned ID is a new nanoid (26 chars), it was created
						// Otherwise it was consolidated with existing
						if (memId.length === 21) created++
						else consolidated++
					} catch (memErr) {
						logger.warn(
							{ memory: mem.memory.slice(0, 60), err: memErr },
							"IndexWorker: failed to store memory, skipping",
						)
					}
				}

				logger.debug(
					{ documentId, created, consolidated, total: memories.length },
					"IndexWorker: memories processed (EverMemOS consolidation)",
				)
			}

			// 5. Extract knowledge graph entities & relationships
			try {
				const graphData = await extractGraphWithCustomPrompt(
					doc.content ?? "",
					doc.orgId,
					{
						title: doc.title ?? undefined,
					},
				)

				if (graphData.entities.length > 0) {
					const graphResult = await ingestGraph(
						graphData.entities,
						graphData.relationships,
						doc.orgId,
						{
							spaceId: spaceId ?? undefined,
							sourceDocumentId: documentId,
						},
					)

					logger.debug(
						{ documentId, nodes: graphResult.nodes, edges: graphResult.edges },
						"IndexWorker: knowledge graph updated",
					)
				}
			} catch (graphErr) {
				// Non-critical — don't fail the document if graph extraction fails
				logger.warn(
					{ documentId, err: graphErr },
					"IndexWorker: graph extraction failed, skipping",
				)
			}

			// 6. Mark document as done
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
