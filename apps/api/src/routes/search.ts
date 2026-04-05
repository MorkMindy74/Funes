import { Hono } from "hono"
import { getSession } from "../middleware/auth.js"
import { logger } from "../logger.js"

export const searchRoutes = new Hono()

// POST / — Semantic search (v3)
// Stub: will be fully implemented in M2/M3 with LanceDB vector search
searchRoutes.post("/", async (c) => {
	const session = getSession(c)
	const body = await c.req.json()
	const startTime = Date.now()

	const { q, containerTags, limit = 10, chunkThreshold = 0, documentThreshold = 0 } = body

	if (!q) {
		return c.json({ error: "Query parameter 'q' is required" }, 400)
	}

	logger.info({ query: q, orgId: session.orgId }, "Search request")

	// TODO (M3): Implement full semantic search with LanceDB
	// For now, return empty results — the pipeline will populate vectors in M2/M3

	return c.json({
		results: [],
		timing: Date.now() - startTime,
		total: 0,
	})
})
