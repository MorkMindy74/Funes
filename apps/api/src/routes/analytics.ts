import { Hono } from "hono"
import { and, eq, gte, count, sql, desc } from "drizzle-orm"
import { db } from "../db/index.js"
import { apiRequests, documents, connections } from "../db/schema.js"
import { getSession } from "../middleware/auth.js"

export const analyticsRoutes = new Hono()

// GET /usage — API usage analytics
analyticsRoutes.get("/usage", async (c) => {
	const session = getSession(c)

	const [totalMemories] = await db
		.select({ count: count() })
		.from(documents)
		.where(eq(documents.orgId, session.orgId))

	return c.json({
		usage: [],
		hourly: [],
		byKey: [],
		totalMemories: totalMemories?.count ?? 0,
		pagination: { currentPage: 1, limit: 20, totalItems: 0, totalPages: 0 },
	})
})

// GET /chat — Chat analytics
analyticsRoutes.get("/chat", async (c) => {
	const emptyPeriod = {
		amountSaved: { current: 0, previousPeriod: 0 },
		tokensProcessed: { current: 0, previousPeriod: 0 },
		tokensSent: { current: 0, previousPeriod: 0 },
		totalTokensSaved: { current: 0, previousPeriod: 0 },
	}

	return c.json({
		analytics: {
			apiUsage: { current: 0, limit: 999999 },
			latency: { current: 0, trend: [], unit: "ms" as const },
			usage: {
				currentDay: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
					new Date().getDay()
				] as "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat",
				tokensByDay: { Fri: 0, Mon: 0, Sat: 0, Sun: 0, Thu: 0, Tue: 0, Wed: 0 },
			},
		},
		overview: {
			"7d": emptyPeriod,
			"30d": emptyPeriod,
			"90d": emptyPeriod,
			lifetime: emptyPeriod,
		},
	})
})

// GET /memory — Memory analytics
analyticsRoutes.get("/memory", async (c) => {
	const session = getSession(c)

	const [totalMemories] = await db
		.select({ count: count() })
		.from(documents)
		.where(eq(documents.orgId, session.orgId))

	const [totalConnections] = await db
		.select({ count: count() })
		.from(connections)
		.where(eq(connections.orgId, session.orgId))

	return c.json({
		totalMemories: totalMemories?.count ?? 0,
		memoriesGrowth: 0,
		totalConnections: totalConnections?.count ?? 0,
		connectionsGrowth: 0,
		searchQueries: 0,
		searchGrowth: 0,
		tokensProcessed: 0,
		tokensGrowth: 0,
	})
})
