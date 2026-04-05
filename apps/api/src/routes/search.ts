import { Hono } from "hono"
import { eq, inArray, and, desc } from "drizzle-orm"
import { db } from "../db/index.js"
import { documents, chunks, spaces, documentsToSpaces, memoryEntries } from "../db/schema.js"
import { getSession } from "../middleware/auth.js"
import { generateEmbedding } from "../processing/embeddings.js"
import { searchChunks, searchMemories } from "../vector/index.js"
import { logger } from "../logger.js"

export const searchRoutes = new Hono()

// POST / — Semantic search (v3) — search through document chunks
searchRoutes.post("/", async (c) => {
	const session = getSession(c)
	const body = await c.req.json()
	const startTime = Date.now()

	const {
		q,
		containerTags,
		limit = 10,
		chunkThreshold = 0,
		documentThreshold = 0,
		includeFullDocs = false,
		includeSummary = false,
		onlyMatchingChunks = true,
	} = body

	if (!q) return c.json({ error: "Query parameter 'q' is required" }, 400)

	logger.info({ query: q, orgId: session.orgId, limit }, "Search v3 request")

	try {
		// 1. Generate embedding for query
		const queryEmbedding = await generateEmbedding(q)

		// 2. Search chunks in LanceDB
		const chunkResults = await searchChunks(queryEmbedding, { limit: limit * 3 })

		if (chunkResults.length === 0) {
			return c.json({ results: [], timing: Date.now() - startTime, total: 0 })
		}

		// 3. Get document IDs from chunk results
		const docIds = [...new Set(chunkResults.map((r) => r.documentId))]

		// 4. Fetch documents and verify org ownership
		const docs = await db
			.select()
			.from(documents)
			.where(and(eq(documents.orgId, session.orgId), inArray(documents.id, docIds)))

		const orgDocIds = new Set(docs.map((d) => d.id))

		// 5. Filter by containerTags if provided
		let allowedDocIds = orgDocIds
		if (containerTags?.length) {
			const spaceRows = await db
				.select({ id: spaces.id })
				.from(spaces)
				.where(
					and(
						eq(spaces.orgId, session.orgId),
						inArray(spaces.containerTag, containerTags),
					),
				)

			if (spaceRows.length > 0) {
				const tagDocLinks = await db
					.selectDistinct({ documentId: documentsToSpaces.documentId })
					.from(documentsToSpaces)
					.where(
						inArray(
							documentsToSpaces.spaceId,
							spaceRows.map((s) => s.id),
						),
					)
				allowedDocIds = new Set(tagDocLinks.map((d) => d.documentId).filter((id) => orgDocIds.has(id)))
			} else {
				allowedDocIds = new Set()
			}
		}

		// 6. Group chunks by document and build results
		const docMap = new Map(docs.map((d) => [d.id, d]))
		const resultsByDoc = new Map<string, { doc: typeof docs[0]; chunks: Array<{ content: string; score: number; isRelevant: boolean }> }>()

		for (const cr of chunkResults) {
			if (!allowedDocIds.has(cr.documentId)) continue
			if (cr.score < chunkThreshold) continue

			const doc = docMap.get(cr.documentId)
			if (!doc) continue

			const existing = resultsByDoc.get(cr.documentId) ?? { doc, chunks: [] }
			existing.chunks.push({
				content: cr.content,
				score: cr.score,
				isRelevant: cr.score > 0.5,
			})
			resultsByDoc.set(cr.documentId, existing)
		}

		// 7. Build final response
		const results = [...resultsByDoc.values()]
			.map(({ doc, chunks: docChunks }) => {
				const avgScore = docChunks.reduce((s, c) => s + c.score, 0) / docChunks.length

				if (avgScore < documentThreshold) return null

				return {
					documentId: doc.id,
					title: doc.title,
					summary: includeSummary ? doc.summary : undefined,
					content: includeFullDocs ? doc.content : undefined,
					metadata: doc.metadata,
					type: doc.type,
					score: avgScore,
					chunks: onlyMatchingChunks ? docChunks.slice(0, 5) : docChunks,
					createdAt: doc.createdAt,
					updatedAt: doc.updatedAt,
				}
			})
			.filter(Boolean)
			.sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0))
			.slice(0, limit)

		return c.json({
			results,
			timing: Date.now() - startTime,
			total: results.length,
		})
	} catch (err) {
		logger.error({ err, query: q }, "Search failed")
		// Fallback: return empty results instead of 500
		return c.json({ results: [], timing: Date.now() - startTime, total: 0 })
	}
})
