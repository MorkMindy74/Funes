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
import { importExportRoutes } from "./routes/import-export.js"
import { memoriesRoutes } from "./routes/memories.js"
import { graphRoutes } from "./routes/graph.js"
import { setupRoutes } from "./routes/setup.js"

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
	c.json({
		status: "ok",
		version: "0.1.0",
		timestamp: new Date().toISOString(),
	}),
)

// ─── Setup Routes (public, no auth) ─────────────────────────────────
app.route("/setup", setupRoutes)

// ─── Better Auth Routes ─────────────────────────────────────────────
app.on(["POST", "GET"], "/api/auth/**", (c) => auth.handler(c.req.raw))

// ─── OAuth Callback (public — state token validates the request) ─────
app.get("/v3/connections/callback", async (c) => {
	// Forward to the callback handler in connections routes
	const url = new URL(c.req.url)
	const code = url.searchParams.get("code") || ""
	const state = url.searchParams.get("state") || ""
	const error = url.searchParams.get("error") || ""
	const errorDesc = url.searchParams.get("error_description") || ""

	// Re-create request context for the handler
	const { validateState } = await import("./services/oauth/common.js")
	const { resolveCredentials } = await import("./services/oauth/common.js")
	const { env: envConfig } = await import("./env.js")

	if (error) {
		return c.redirect(
			`${envConfig.FRONTEND_URL}/?error=${encodeURIComponent(errorDesc || error)}`,
		)
	}

	if (!code || !state) {
		return c.redirect(`${envConfig.FRONTEND_URL}/?error=missing_code_or_state`)
	}

	const stateData = validateState(state)
	if (!stateData) {
		return c.redirect(`${envConfig.FRONTEND_URL}/?error=invalid_state`)
	}

	const { provider, orgId, userId, redirectUrl, containerTags, codeVerifier } =
		stateData
	const creds = await resolveCredentials(
		provider as "google-drive" | "notion" | "onedrive",
		orgId,
	)
	if (!creds) {
		return c.redirect(`${envConfig.FRONTEND_URL}/?error=missing_credentials`)
	}

	try {
		let accessToken: string
		let refreshToken: string | null = null
		let expiresAt: Date
		let email = ""
		let metadata: Record<string, unknown> = {}

		if (provider === "google-drive") {
			const gdrive = await import("./services/oauth/google-drive.js")
			const tokens = await gdrive.exchangeCode(creds, code, codeVerifier || "")
			accessToken = tokens.accessToken
			refreshToken = tokens.refreshToken
			expiresAt = tokens.expiresAt
			const userInfo = await gdrive.getUserInfo(accessToken)
			email = userInfo.email
		} else if (provider === "notion") {
			const notion = await import("./services/oauth/notion.js")
			const tokens = await notion.exchangeCode(creds, code)
			accessToken = tokens.accessToken
			expiresAt = tokens.expiresAt
			email = tokens.email || ""
			metadata = {
				workspaceId: tokens.workspaceId,
				workspaceName: tokens.workspaceName,
			}
		} else if (provider === "onedrive") {
			const od = await import("./services/oauth/onedrive.js")
			const tokens = await od.exchangeCode(creds, code, codeVerifier || "")
			accessToken = tokens.accessToken
			refreshToken = tokens.refreshToken
			expiresAt = tokens.expiresAt
			const userInfo = await od.getUserInfo(accessToken)
			email = userInfo.email
		} else {
			return c.redirect(`${envConfig.FRONTEND_URL}/?error=unknown_provider`)
		}

		const { nanoid } = await import("nanoid")
		const { db: database } = await import("./db/index.js")
		const { connections } = await import("./db/schema.js")
		const connectionId = nanoid()

		await database.insert(connections).values({
			id: connectionId,
			provider,
			orgId,
			userId,
			email,
			accessToken,
			refreshToken,
			expiresAt,
			containerTags: containerTags ?? [],
			metadata,
			createdAt: new Date(),
		})

		logger.info(
			{ provider, orgId, connectionId, email },
			"OAuth connection established",
		)

		const successUrl = new URL(redirectUrl || envConfig.FRONTEND_URL)
		successUrl.searchParams.set("connection", "success")
		successUrl.searchParams.set("provider", provider)
		return c.redirect(successUrl.toString())
	} catch (err) {
		logger.error({ provider, err }, "OAuth token exchange failed")
		const errMsg = err instanceof Error ? err.message : "token_exchange_failed"
		return c.redirect(
			`${envConfig.FRONTEND_URL}/?error=${encodeURIComponent(errMsg)}`,
		)
	}
})

// ─── Protected API Routes (/v3) ─────────────────────────────────────
const v3 = new Hono()
v3.use("*", authMiddleware)

v3.route("/documents", documentsRoutes)
v3.route("/search", searchRoutes)
v3.route("/projects", projectsRoutes)
v3.route("/settings", settingsRoutes)
v3.route("/connections", connectionsRoutes)
v3.route("/analytics", analyticsRoutes)
v3.route("/memories", memoriesRoutes)
v3.route("/graph", graphRoutes)

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

// ─── Import/Export Routes ──────────────────────────────────────────
const dataApp = new Hono()
dataApp.use("*", authMiddleware)
dataApp.route("/", importExportRoutes)
app.route("/v3/data", dataApp)

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

		logger.info(
			"Processing pipeline workers started (extract → chunk → embed → index)",
		)

		// Schedule daily memory maintenance (decay, forget expired)
		const { runMemoryMaintenance } = await import(
			"./processing/memory-manager.js"
		)
		const MAINTENANCE_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours
		const maintenanceTimer = setInterval(async () => {
			try {
				const result = await runMemoryMaintenance()
				logger.info(result, "Scheduled memory maintenance complete")
			} catch (err) {
				logger.error({ err }, "Scheduled memory maintenance failed")
			}
		}, MAINTENANCE_INTERVAL)

		// Run once on startup (after a 30s delay to let DB settle)
		setTimeout(async () => {
			try {
				await runMemoryMaintenance()
				logger.info("Initial memory maintenance complete")
			} catch {
				/* ignore on first run */
			}
		}, 30000)

		// Graceful shutdown
		const shutdown = async () => {
			logger.info("Shutting down workers...")
			clearInterval(maintenanceTimer)
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
		logger.warn(
			"Redis not available — processing pipeline disabled. Documents will stay in 'queued' status.",
		)
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
