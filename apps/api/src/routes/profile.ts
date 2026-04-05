import { Hono } from "hono"
import { eq, and, desc, gte } from "drizzle-orm"
import { db } from "../db/index.js"
import { memoryEntries, spaces } from "../db/schema.js"
import { getSession } from "../middleware/auth.js"
import { generateEmbedding } from "../processing/embeddings.js"
import { searchMemories } from "../vector/index.js"
import { logger } from "../logger.js"

export const profileRoutes = new Hono()

// POST / — Generate user profile from memories
profileRoutes.post("/", async (c) => {
	const session = getSession(c)
	const body = await c.req.json().catch(() => ({}))
	const { q, containerTag } = body as { q?: string; containerTag?: string }

	try {
		// 1. Get static facts (isStatic = true, always included)
		const staticFacts = await db
			.select({
				id: memoryEntries.id,
				memory: memoryEntries.memory,
				confidence: memoryEntries.confidence,
				memoryLevel: memoryEntries.memoryLevel,
				updatedAt: memoryEntries.updatedAt,
			})
			.from(memoryEntries)
			.where(
				and(
					eq(memoryEntries.orgId, session.orgId),
					eq(memoryEntries.isStatic, true),
					eq(memoryEntries.isLatest, true),
					eq(memoryEntries.isForgotten, false),
				),
			)
			.orderBy(desc(memoryEntries.updatedAt))
			.limit(50)

		// 2. Get dynamic context (recent memories, last 30 days)
		const thirtyDaysAgo = new Date()
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

		const dynamicMemories = await db
			.select({
				id: memoryEntries.id,
				memory: memoryEntries.memory,
				confidence: memoryEntries.confidence,
				memoryLevel: memoryEntries.memoryLevel,
				updatedAt: memoryEntries.updatedAt,
			})
			.from(memoryEntries)
			.where(
				and(
					eq(memoryEntries.orgId, session.orgId),
					eq(memoryEntries.isLatest, true),
					eq(memoryEntries.isForgotten, false),
					eq(memoryEntries.isStatic, false),
					gte(memoryEntries.updatedAt, thirtyDaysAgo),
				),
			)
			.orderBy(desc(memoryEntries.confidence))
			.limit(50)

		// 3. If query provided, include relevant search results
		let searchResults: Array<{ memory: string; score: number }> = []
		if (q) {
			try {
				const queryEmbedding = await generateEmbedding(q)
				const results = await searchMemories(queryEmbedding, { limit: 10 })

				searchResults = results.map((r) => ({
					memory: r.memory,
					score: r.score,
				}))
			} catch {
				// Embedding/search may not be ready yet
			}
		}

		return c.json({
			static: staticFacts.map((f) => ({
				id: f.id,
				memory: f.memory,
				confidence: f.confidence,
				level: f.memoryLevel,
				updatedAt: f.updatedAt.toISOString(),
			})),
			dynamic: dynamicMemories.map((m) => ({
				id: m.id,
				memory: m.memory,
				confidence: m.confidence,
				level: m.memoryLevel,
				updatedAt: m.updatedAt.toISOString(),
			})),
			search: searchResults,
		})
	} catch (err) {
		logger.error({ err }, "Profile generation failed")
		return c.json({ static: [], dynamic: [], search: [] })
	}
})
