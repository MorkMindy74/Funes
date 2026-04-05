/**
 * Setup routes — First-time setup wizard for self-hosted Funes.
 *
 * GET  /status  — System health check + first-run detection (public)
 * POST /init    — Create first admin user + organization (public, one-time only)
 */

import { Hono } from "hono"
import { db } from "../db/index.js"
import { logger } from "../logger.js"
import { auth } from "../auth/index.js"
import { env } from "../env.js"
import { isRedisAvailable } from "../queue/connection.js"
import { sql } from "drizzle-orm"

export const setupRoutes = new Hono()

// ─── GET /status — System health + first-run detection ────────────

setupRoutes.get("/status", async (c) => {
	const checks: Record<string, { ok: boolean; message?: string }> = {}

	// 1. Database
	try {
		await db.execute(sql`SELECT 1`)
		checks.database = { ok: true }
	} catch (error) {
		checks.database = {
			ok: false,
			message: error instanceof Error ? error.message : "Cannot connect to PostgreSQL",
		}
	}

	// 2. Redis
	try {
		const redis = await isRedisAvailable()
		checks.redis = redis
			? { ok: true }
			: { ok: false, message: "Redis not reachable — processing pipeline will be disabled" }
	} catch {
		checks.redis = { ok: false, message: "Redis check failed" }
	}

	// 3. Ollama (optional)
	if (env.OLLAMA_URL) {
		try {
			const resp = await fetch(`${env.OLLAMA_URL}/api/tags`, {
				signal: AbortSignal.timeout(3000),
			}).catch(() => null)
			if (resp?.ok) {
				const data = (await resp.json()) as { models?: Array<{ name: string }> }
				const models = data.models?.map((m) => m.name) ?? []
				checks.ollama = {
					ok: true,
					message: models.length > 0 ? `Models: ${models.join(", ")}` : "Connected, no models pulled yet",
				}
			} else {
				checks.ollama = { ok: false, message: "Ollama not responding" }
			}
		} catch {
			checks.ollama = { ok: false, message: "Cannot reach Ollama" }
		}
	} else {
		checks.ollama = { ok: false, message: "Not configured (optional — set OLLAMA_URL)" }
	}

	// 4. Firecrawl (optional)
	if (env.FIRECRAWL_URL) {
		try {
			const resp = await fetch(env.FIRECRAWL_URL, {
				signal: AbortSignal.timeout(3000),
			}).catch(() => null)
			checks.firecrawl = resp?.ok
				? { ok: true }
				: { ok: false, message: "Firecrawl not responding" }
		} catch {
			checks.firecrawl = { ok: false, message: "Cannot reach Firecrawl" }
		}
	} else {
		checks.firecrawl = { ok: false, message: "Not configured (optional — set FIRECRAWL_URL)" }
	}

	// 5. Check if any users exist (first-run detection)
	let hasUsers = false
	let userCount = 0
	try {
		const result = await db.execute(sql`SELECT COUNT(*)::int as count FROM "user"`)
		userCount = (result.rows[0] as { count: number })?.count ?? 0
		hasUsers = userCount > 0
	} catch {
		// Table might not exist yet
		hasUsers = false
	}

	const allCriticalOk = checks.database?.ok && checks.redis?.ok

	return c.json({
		initialized: hasUsers,
		userCount,
		ready: allCriticalOk,
		services: checks,
		version: "0.1.0",
	})
})

// ─── POST /init — Create first admin user + org ──────────────────

setupRoutes.post("/init", async (c) => {
	// Check if already initialized
	try {
		const result = await db.execute(sql`SELECT COUNT(*)::int as count FROM "user"`)
		const count = (result.rows[0] as { count: number })?.count ?? 0
		if (count > 0) {
			return c.json(
				{ error: "Already initialized. Use the login page to sign in." },
				409,
			)
		}
	} catch (error) {
		logger.error({ error }, "Setup init: cannot check user count")
		return c.json({ error: "Database not ready" }, 503)
	}

	const body = await c.req.json().catch(() => null)
	if (!body) {
		return c.json({ error: "Invalid JSON body" }, 400)
	}

	const { name, email, password } = body as {
		name?: string
		email?: string
		password?: string
	}

	if (!email || !password) {
		return c.json({ error: "Email and password are required" }, 400)
	}

	if (password.length < 8) {
		return c.json({ error: "Password must be at least 8 characters" }, 400)
	}

	try {
		// Use better-auth's internal API to create the user via a synthetic request.
		// We call the sign-up endpoint directly.
		const signUpUrl = `${env.BETTER_AUTH_URL}/api/auth/sign-up/email`
		const signUpResp = await fetch(signUpUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: name || email.split("@")[0],
				email,
				password,
			}),
		})

		if (!signUpResp.ok) {
			const errBody = await signUpResp.text().catch(() => "Unknown error")
			logger.error({ status: signUpResp.status, body: errBody }, "Setup init: sign-up failed")
			return c.json({ error: `Sign-up failed: ${errBody}` }, 500)
		}

		const userData = (await signUpResp.json()) as { user?: { id: string; email: string } }

		// Forward set-cookie headers from sign-up response
		const setCookies = signUpResp.headers.getSetCookie?.() ?? []

		logger.info(
			{ email, userId: userData?.user?.id },
			"Setup init: first admin user created",
		)

		// Create a default organization for the user
		// We need the session cookie to call the org creation endpoint
		const cookies = setCookies.join("; ")
		let orgCreated = false

		if (cookies) {
			try {
				const orgResp = await fetch(
					`${env.BETTER_AUTH_URL}/api/auth/organization/create`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Cookie: cookies,
						},
						body: JSON.stringify({
							name: name ? `${name}'s Space` : "My Space",
							slug: `org-${Date.now()}`,
						}),
					},
				)
				orgCreated = orgResp.ok
				if (!orgResp.ok) {
					const errBody = await orgResp.text().catch(() => "")
					logger.warn({ status: orgResp.status, body: errBody }, "Setup init: org creation failed")
				}
			} catch (orgError) {
				logger.warn({ error: orgError }, "Setup init: org creation error")
			}
		}

		// Build response with set-cookie headers so the user is immediately logged in
		const response = c.json({
			success: true,
			user: userData?.user,
			organizationCreated: orgCreated,
			message: "Admin account created. You are now logged in.",
		})

		for (const cookie of setCookies) {
			response.headers.append("Set-Cookie", cookie)
		}

		return response
	} catch (error) {
		logger.error({ error }, "Setup init failed")
		return c.json({ error: "Setup failed" }, 500)
	}
})
