import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger as honoLogger } from "hono/logger"
import { env } from "./env.js"
import { logger } from "./logger.js"
import { auth } from "./auth/index.js"
import { authMiddleware } from "./middleware/auth.js"
import { documentsRoutes } from "./routes/documents.js"
import { searchRoutes } from "./routes/search.js"
import { projectsRoutes } from "./routes/projects.js"
import { settingsRoutes } from "./routes/settings.js"
import { connectionsRoutes } from "./routes/connections.js"
import { analyticsRoutes } from "./routes/analytics.js"
import { profileRoutes } from "./routes/profile.js"
import { chatRoutes } from "./routes/chat.js"

const app = new Hono()

// ─── Global Middleware ──────────────────────────────────────────────
app.use(
	"*",
	cors({
		origin: [env.FRONTEND_URL, "http://localhost:3000"],
		credentials: true,
		allowHeaders: ["Content-Type", "Authorization", "x-org-id"],
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
	}),
)

if (env.NODE_ENV === "development") {
	app.use("*", honoLogger())
}

// ─── Health Check ───────────────────────────────────────────────────
app.get("/health", (c) =>
	c.json({ status: "ok", version: "0.1.0", timestamp: new Date().toISOString() }),
)

// ─── Better Auth Routes ─────────────────────────────────────────────
app.on(["POST", "GET"], "/api/auth/**", (c) => auth.handler(c.req.raw))

// ─── Protected API Routes (/v3) ─────────────────────────────────────
const v3 = new Hono()
v3.use("*", authMiddleware)

v3.route("/documents", documentsRoutes)
v3.route("/search", searchRoutes)
v3.route("/projects", projectsRoutes)
v3.route("/settings", settingsRoutes)
v3.route("/connections", connectionsRoutes)
v3.route("/analytics", analyticsRoutes)

// v4 routes
const v4 = new Hono()
v4.use("*", authMiddleware)
v4.route("/profile", profileRoutes)
app.route("/v4", v4)

// Container tags
v3.get("/container-tags/list", async (c) => {
	// Implemented in projects route — re-export
	const { getSession } = await import("./middleware/auth.js")
	const { db } = await import("./db/index.js")
	const { spaces } = await import("./db/schema.js")
	const { eq } = await import("drizzle-orm")

	const session = getSession(c)
	const allSpaces = await db
		.select()
		.from(spaces)
		.where(eq(spaces.orgId, session.orgId))

	return c.json(
		allSpaces.map((s) => ({
			id: s.id,
			name: s.name ?? "",
			containerTag: s.containerTag ?? "",
			createdAt: s.createdAt.toISOString(),
			updatedAt: s.updatedAt.toISOString(),
			isExperimental: s.isExperimental,
			emoji: s.emoji,
			isNova: s.containerTag?.startsWith("sm_project_") ?? false,
		})),
	)
})

// MCP login check
v3.get("/mcp/has-login", (c) => c.json({ previousLogin: true }))

app.route("/v3", v3)

// ─── Chat Routes (top-level, frontend calls /chat directly) ────────
const chatApp = new Hono()
chatApp.use("*", authMiddleware)
chatApp.route("/", chatRoutes)
app.route("/chat", chatApp)

// ─── Start Workers (if Redis available) ─────────────────────────────
import { isRedisAvailable } from "./queue/connection.js"

isRedisAvailable().then(async (available) => {
	if (available) {
		// Dynamic imports to avoid errors when Redis is down
		const { extractWorker } = await import("./queue/workers/extract.worker.js")
		const { chunkWorker } = await import("./queue/workers/chunk.worker.js")
		const { embedWorker } = await import("./queue/workers/embed.worker.js")
		const { indexWorker } = await import("./queue/workers/index.worker.js")

		logger.info("Processing pipeline workers started (extract → chunk → embed → index)")

		// Graceful shutdown
		const shutdown = async () => {
			logger.info("Shutting down workers...")
			await Promise.all([
				extractWorker.close(),
				chunkWorker.close(),
				embedWorker.close(),
				indexWorker.close(),
			])
		}
		process.on("SIGTERM", shutdown)
		process.on("SIGINT", shutdown)
	} else {
		logger.warn("Redis not available — processing pipeline disabled. Documents will stay in 'queued' status.")
	}
})

// ─── Start Server ───────────────────────────────────────────────────
logger.info(`Starting Funes API on port ${env.PORT}...`)

serve(
	{
		fetch: app.fetch,
		port: env.PORT,
	},
	(info) => {
		logger.info(`Funes API running at http://localhost:${info.port}`)
		logger.info(`Auth:     http://localhost:${info.port}/api/auth`)
		logger.info(`API (v3): http://localhost:${info.port}/v3`)
		logger.info(`Health:   http://localhost:${info.port}/health`)
	},
)

export default app
