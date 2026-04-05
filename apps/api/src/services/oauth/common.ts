/**
 * OAuth common utilities — state management, PKCE, token helpers.
 */

import { randomBytes, createHash } from "node:crypto"
import { env } from "../../env.js"
import { db } from "../../db/index.js"
import { organizationSettings } from "../../db/schema.js"
import { eq } from "drizzle-orm"

// ─── State Token ──────────────────────────────────────────────────

/** In-memory state store with TTL (5 min). Simple, no extra DB table needed. */
const stateStore = new Map<string, { data: StateData; expiresAt: number }>()

export interface StateData {
	provider: string
	orgId: string
	userId: string
	redirectUrl: string
	containerTags?: string[]
	codeVerifier?: string // For PKCE
}

export function generateState(data: StateData): string {
	const state = randomBytes(32).toString("hex")
	stateStore.set(state, {
		data,
		expiresAt: Date.now() + 5 * 60 * 1000, // 5 min TTL
	})
	return state
}

export function validateState(state: string): StateData | null {
	const entry = stateStore.get(state)
	if (!entry) return null
	stateStore.delete(state)
	if (Date.now() > entry.expiresAt) return null
	return entry.data
}

// Periodic cleanup
setInterval(() => {
	const now = Date.now()
	for (const [key, entry] of stateStore.entries()) {
		if (now > entry.expiresAt) stateStore.delete(key)
	}
}, 60000)

// ─── PKCE ─────────────────────────────────────────────────────────

export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
	const codeVerifier = randomBytes(32).toString("base64url")
	const codeChallenge = createHash("sha256")
		.update(codeVerifier)
		.digest("base64url")
	return { codeVerifier, codeChallenge }
}

// ─── OAuth Credentials Resolution ─────────────────────────────────

export interface OAuthCredentials {
	clientId: string
	clientSecret: string
	redirectUri: string
}

type Provider = "google-drive" | "notion" | "onedrive"

/**
 * Resolve OAuth credentials: first check org-specific custom keys,
 * then fall back to system-wide env vars.
 */
export async function resolveCredentials(
	provider: Provider,
	orgId: string,
): Promise<OAuthCredentials | null> {
	// 1. Check org-level custom keys
	const [settings] = await db
		.select()
		.from(organizationSettings)
		.where(eq(organizationSettings.orgId, orgId))
		.limit(1)

	if (settings) {
		if (provider === "google-drive" && settings.googleDriveCustomKeyEnabled) {
			if (settings.googleDriveClientId && settings.googleDriveClientSecret) {
				return {
					clientId: settings.googleDriveClientId,
					clientSecret: settings.googleDriveClientSecret,
					redirectUri: `${env.BETTER_AUTH_URL}/v3/connections/callback`,
				}
			}
		}

		if (provider === "notion" && settings.notionCustomKeyEnabled) {
			if (settings.notionClientId && settings.notionClientSecret) {
				return {
					clientId: settings.notionClientId,
					clientSecret: settings.notionClientSecret,
					redirectUri: `${env.BETTER_AUTH_URL}/v3/connections/callback`,
				}
			}
		}

		if (provider === "onedrive" && settings.onedriveCustomKeyEnabled) {
			if (settings.onedriveClientId && settings.onedriveClientSecret) {
				return {
					clientId: settings.onedriveClientId,
					clientSecret: settings.onedriveClientSecret,
					redirectUri: `${env.BETTER_AUTH_URL}/v3/connections/callback`,
				}
			}
		}
	}

	// 2. Fall back to system env vars
	if (provider === "google-drive" && env.GOOGLE_DRIVE_CLIENT_ID) {
		return {
			clientId: env.GOOGLE_DRIVE_CLIENT_ID,
			clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET,
			redirectUri: `${env.BETTER_AUTH_URL}/v3/connections/callback`,
		}
	}

	if (provider === "notion" && env.NOTION_CLIENT_ID) {
		return {
			clientId: env.NOTION_CLIENT_ID,
			clientSecret: env.NOTION_CLIENT_SECRET,
			redirectUri: `${env.BETTER_AUTH_URL}/v3/connections/callback`,
		}
	}

	if (provider === "onedrive" && env.ONEDRIVE_CLIENT_ID) {
		return {
			clientId: env.ONEDRIVE_CLIENT_ID,
			clientSecret: env.ONEDRIVE_CLIENT_SECRET,
			redirectUri: `${env.BETTER_AUTH_URL}/v3/connections/callback`,
		}
	}

	return null
}

// ─── Token Exchange Helper ────────────────────────────────────────

export async function exchangeToken(
	tokenUrl: string,
	params: Record<string, string>,
	options?: { basicAuth?: { username: string; password: string } },
): Promise<Record<string, unknown>> {
	const headers: Record<string, string> = {
		"Content-Type": "application/x-www-form-urlencoded",
		Accept: "application/json",
	}

	if (options?.basicAuth) {
		const { username, password } = options.basicAuth
		headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
	}

	const response = await fetch(tokenUrl, {
		method: "POST",
		headers,
		body: new URLSearchParams(params).toString(),
		signal: AbortSignal.timeout(15000),
	})

	if (!response.ok) {
		const errText = await response.text().catch(() => "")
		throw new Error(`Token exchange failed (${response.status}): ${errText}`)
	}

	return (await response.json()) as Record<string, unknown>
}

// ─── Token Refresh Helper ─────────────────────────────────────────

export async function refreshAccessToken(
	tokenUrl: string,
	clientId: string,
	clientSecret: string,
	refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date; refreshToken?: string }> {
	const data = await exchangeToken(tokenUrl, {
		grant_type: "refresh_token",
		client_id: clientId,
		client_secret: clientSecret,
		refresh_token: refreshToken,
	})

	const expiresIn = (data.expires_in as number) ?? 3600
	const expiresAt = new Date(Date.now() + expiresIn * 1000)

	return {
		accessToken: data.access_token as string,
		expiresAt,
		refreshToken: (data.refresh_token as string) ?? refreshToken,
	}
}
