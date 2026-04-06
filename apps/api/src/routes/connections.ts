/**
 * Connection routes — OAuth flow for Google Drive, Notion, OneDrive.
 *
 * POST   /:provider           — Initiate OAuth (returns authLink)
 * GET    /callback             — OAuth callback (exchanges code for tokens)
 * GET    /                     — List all connections
 * POST   /list                 — List all connections (compat)
 * GET    /:connectionId        — Get single connection
 * DELETE /:connectionId        — Delete connection
 * POST   /:connectionId/refresh — Force token refresh
 */

import { Hono } from "hono"
import { and, eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { connections } from "../db/schema.js"
import { getSession } from "../middleware/auth.js"
import {
	resolveCredentials,
	validateState,
	refreshAccessToken,
} from "../services/oauth/common.js"
import { env } from "../env.js"
import { logger } from "../logger.js"

export const connectionsRoutes = new Hono()

const SUPPORTED_PROVIDERS = ["google-drive", "notion", "onedrive"] as const
type Provider = (typeof SUPPORTED_PROVIDERS)[number]

// ─── POST /:provider — Initiate OAuth ────────────────────────────

connectionsRoutes.post("/:provider", async (c) => {
	const session = getSession(c)
	const provider = c.req.param("provider") as Provider

	if (!SUPPORTED_PROVIDERS.includes(provider)) {
		return c.json({ error: `Unsupported provider: ${provider}` }, 400)
	}

	// Resolve OAuth credentials (org custom keys → env vars)
	const creds = await resolveCredentials(provider, session.orgId)
	if (!creds) {
		return c.json(
			{
				error: `No OAuth credentials configured for ${provider}. Add them in Settings or set environment variables.`,
				setup: getSetupHint(provider),
			},
			400,
		)
	}

	const body = await c.req.json().catch(() => ({}))
	const { redirectUrl, containerTags } = body as {
		redirectUrl?: string
		containerTags?: string[]
	}

	const frontendRedirect = redirectUrl || `${env.FRONTEND_URL}/`

	try {
		let authLink: string

		if (provider === "google-drive") {
			const gdrive = await import("../services/oauth/google-drive.js")
			const result = gdrive.getAuthUrl(creds, {
				orgId: session.orgId,
				userId: session.user.id,
				redirectUrl: frontendRedirect,
				containerTags,
			})
			authLink = result.authLink
		} else if (provider === "notion") {
			const notion = await import("../services/oauth/notion.js")
			const result = notion.getAuthUrl(creds, {
				orgId: session.orgId,
				userId: session.user.id,
				redirectUrl: frontendRedirect,
				containerTags,
			})
			authLink = result.authLink
		} else if (provider === "onedrive") {
			const od = await import("../services/oauth/onedrive.js")
			const result = od.getAuthUrl(creds, {
				orgId: session.orgId,
				userId: session.user.id,
				redirectUrl: frontendRedirect,
				containerTags,
			})
			authLink = result.authLink
		} else {
			return c.json({ error: "Unknown provider" }, 400)
		}

		logger.info({ provider, orgId: session.orgId }, "OAuth flow initiated")

		return c.json({ data: { authLink } })
	} catch (error) {
		logger.error({ provider, error }, "OAuth initiation failed")
		return c.json(
			{
				error:
					error instanceof Error ? error.message : "OAuth initiation failed",
			},
			500,
		)
	}
})

// ─── GET /callback — OAuth callback ──────────────────────────────

connectionsRoutes.get("/callback", async (c) => {
	const code = c.req.query("code")
	const state = c.req.query("state")
	const error = c.req.query("error")

	// Handle provider-side errors
	if (error) {
		const errorDesc = c.req.query("error_description") || error
		logger.warn({ error, errorDesc }, "OAuth callback error from provider")
		return c.redirect(
			`${env.FRONTEND_URL}/?error=${encodeURIComponent(errorDesc)}`,
		)
	}

	if (!code || !state) {
		return c.redirect(`${env.FRONTEND_URL}/?error=missing_code_or_state`)
	}

	// Validate state token
	const stateData = validateState(state)
	if (!stateData) {
		logger.warn({ state }, "OAuth callback: invalid or expired state")
		return c.redirect(`${env.FRONTEND_URL}/?error=invalid_state`)
	}

	const { provider, orgId, userId, redirectUrl, containerTags, codeVerifier } =
		stateData

	// Resolve credentials again for token exchange
	const creds = await resolveCredentials(provider as Provider, orgId)
	if (!creds) {
		return c.redirect(`${env.FRONTEND_URL}/?error=missing_credentials`)
	}

	try {
		let accessToken: string
		let refreshToken: string | null = null
		let expiresAt: Date
		let email = ""
		let metadata: Record<string, unknown> = {}

		if (provider === "google-drive") {
			const gdrive = await import("../services/oauth/google-drive.js")
			const tokens = await gdrive.exchangeCode(creds, code, codeVerifier || "")
			accessToken = tokens.accessToken
			refreshToken = tokens.refreshToken
			expiresAt = tokens.expiresAt

			const userInfo = await gdrive.getUserInfo(accessToken)
			email = userInfo.email
		} else if (provider === "notion") {
			const notion = await import("../services/oauth/notion.js")
			const tokens = await notion.exchangeCode(creds, code)
			accessToken = tokens.accessToken
			refreshToken = null
			expiresAt = tokens.expiresAt
			email = tokens.email || ""
			metadata = {
				workspaceId: tokens.workspaceId,
				workspaceName: tokens.workspaceName,
			}
		} else if (provider === "onedrive") {
			const od = await import("../services/oauth/onedrive.js")
			const tokens = await od.exchangeCode(creds, code, codeVerifier || "")
			accessToken = tokens.accessToken
			refreshToken = tokens.refreshToken
			expiresAt = tokens.expiresAt

			const userInfo = await od.getUserInfo(accessToken)
			email = userInfo.email
		} else {
			return c.redirect(`${env.FRONTEND_URL}/?error=unknown_provider`)
		}

		// Store connection in database
		const connectionId = nanoid()
		await db.insert(connections).values({
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

		// Redirect back to frontend with success
		const successUrl = new URL(redirectUrl || env.FRONTEND_URL)
		successUrl.searchParams.set("connection", "success")
		successUrl.searchParams.set("provider", provider)
		return c.redirect(successUrl.toString())
	} catch (error) {
		logger.error({ provider, error }, "OAuth token exchange failed")
		const errMsg =
			error instanceof Error ? error.message : "token_exchange_failed"
		return c.redirect(
			`${env.FRONTEND_URL}/?error=${encodeURIComponent(errMsg)}`,
		)
	}
})

// ─── POST /:connectionId/refresh — Force token refresh ───────────

connectionsRoutes.post("/:connectionId/refresh", async (c) => {
	const session = getSession(c)
	const connectionId = c.req.param("connectionId")

	// Avoid matching "list" as connectionId
	if (connectionId === "list" || connectionId === "callback") {
		return c.json({ error: "Invalid connection ID" }, 400)
	}

	const [conn] = await db
		.select()
		.from(connections)
		.where(
			and(
				eq(connections.id, connectionId),
				eq(connections.orgId, session.orgId),
			),
		)
		.limit(1)

	if (!conn) return c.json({ error: "Connection not found" }, 404)

	if (!conn.refreshToken) {
		return c.json(
			{ error: "This connection type does not support token refresh" },
			400,
		)
	}

	const creds = await resolveCredentials(
		conn.provider as Provider,
		session.orgId,
	)
	if (!creds) {
		return c.json({ error: "OAuth credentials not found" }, 400)
	}

	try {
		let tokenUrl: string
		if (conn.provider === "google-drive") {
			tokenUrl = "https://oauth2.googleapis.com/token"
		} else if (conn.provider === "onedrive") {
			tokenUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
		} else {
			return c.json(
				{ error: "Token refresh not supported for this provider" },
				400,
			)
		}

		const refreshed = await refreshAccessToken(
			tokenUrl,
			creds.clientId,
			creds.clientSecret,
			conn.refreshToken,
		)

		await db
			.update(connections)
			.set({
				accessToken: refreshed.accessToken,
				expiresAt: refreshed.expiresAt,
				refreshToken: refreshed.refreshToken || conn.refreshToken,
			})
			.where(eq(connections.id, connectionId))

		logger.info({ connectionId, provider: conn.provider }, "Token refreshed")

		return c.json({
			success: true,
			expiresAt: refreshed.expiresAt.toISOString(),
		})
	} catch (error) {
		logger.error({ connectionId, error }, "Token refresh failed")
		return c.json(
			{ error: error instanceof Error ? error.message : "Refresh failed" },
			500,
		)
	}
})

// ─── POST /list — List connections (compat) ──────────────────────

connectionsRoutes.post("/list", async (c) => {
	const session = getSession(c)
	const conns = await db
		.select()
		.from(connections)
		.where(eq(connections.orgId, session.orgId))

	return c.json(formatConnections(conns))
})

// ─── GET / — Get all connections ─────────────────────────────────

connectionsRoutes.get("/", async (c) => {
	const session = getSession(c)
	const conns = await db
		.select()
		.from(connections)
		.where(eq(connections.orgId, session.orgId))

	return c.json(formatConnections(conns))
})

// ─── GET /:connectionId — Get single connection ──────────────────

connectionsRoutes.get("/:connectionId", async (c) => {
	const session = getSession(c)
	const connectionId = c.req.param("connectionId")

	if (connectionId === "callback") {
		// This is handled by the callback route above
		return c.json({ error: "Use GET /connections/callback" }, 400)
	}

	const [conn] = await db
		.select()
		.from(connections)
		.where(
			and(
				eq(connections.id, connectionId),
				eq(connections.orgId, session.orgId),
			),
		)
		.limit(1)

	if (!conn) return c.json({ error: "Connection not found" }, 404)

	return c.json({
		id: conn.id,
		provider: conn.provider,
		email: conn.email,
		documentLimit: conn.documentLimit,
		containerTags: conn.containerTags,
		metadata: conn.metadata,
		expiresAt: conn.expiresAt?.toISOString(),
		createdAt: conn.createdAt.toISOString(),
		isExpired: conn.expiresAt ? conn.expiresAt < new Date() : false,
	})
})

// ─── DELETE /:connectionId — Delete connection ───────────────────

connectionsRoutes.delete("/:connectionId", async (c) => {
	const session = getSession(c)
	const connectionId = c.req.param("connectionId")

	const [conn] = await db
		.delete(connections)
		.where(
			and(
				eq(connections.id, connectionId),
				eq(connections.orgId, session.orgId),
			),
		)
		.returning({ id: connections.id, provider: connections.provider })

	if (!conn) return c.json({ error: "Connection not found" }, 404)

	logger.info({ connectionId, provider: conn.provider }, "Connection deleted")

	return c.json({ id: conn.id, provider: conn.provider })
})

// ─── Helpers ──────────────────────────────────────────────────────

function formatConnections(conns: Array<typeof connections.$inferSelect>) {
	return conns.map((conn) => ({
		id: conn.id,
		provider: conn.provider,
		email: conn.email,
		documentLimit: conn.documentLimit,
		containerTags: conn.containerTags,
		metadata: conn.metadata,
		expiresAt: conn.expiresAt?.toISOString(),
		createdAt: conn.createdAt.toISOString(),
		isExpired: conn.expiresAt ? conn.expiresAt < new Date() : false,
	}))
}

function getSetupHint(provider: string): Record<string, string> {
	switch (provider) {
		case "google-drive":
			return {
				envVars: "GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET",
				console: "https://console.cloud.google.com/apis/credentials",
				docs: "Create OAuth 2.0 Client ID with redirect URI: <backend_url>/v3/connections/callback",
			}
		case "notion":
			return {
				envVars: "NOTION_CLIENT_ID, NOTION_CLIENT_SECRET",
				console: "https://www.notion.so/my-integrations",
				docs: "Create public integration with redirect URI: <backend_url>/v3/connections/callback",
			}
		case "onedrive":
			return {
				envVars: "ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET",
				console: "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps",
				docs: "Register app with redirect URI: <backend_url>/v3/connections/callback",
			}
		default:
			return {}
	}
}
