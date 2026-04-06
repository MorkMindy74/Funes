/**
 * Notion OAuth — Authorization, token exchange, workspace info.
 * Note: Notion does NOT support PKCE and uses Basic Auth for token exchange.
 */

import type { OAuthCredentials, StateData } from "./common.js"
import { generateState, exchangeToken } from "./common.js"

const AUTH_URL = "https://api.notion.com/v1/oauth/authorize"
const TOKEN_URL = "https://api.notion.com/v1/oauth/token"

/** Build Notion OAuth authorization URL */
export function getAuthUrl(
	creds: OAuthCredentials,
	stateData: Omit<StateData, "codeVerifier" | "provider">,
): { authLink: string; state: string } {
	const state = generateState({
		...stateData,
		provider: "notion",
	})

	const params = new URLSearchParams({
		client_id: creds.clientId,
		redirect_uri: creds.redirectUri,
		response_type: "code",
		owner: "user",
		state,
	})

	return {
		authLink: `${AUTH_URL}?${params.toString()}`,
		state,
	}
}

/** Exchange authorization code for token (Notion uses Basic Auth) */
export async function exchangeCode(
	creds: OAuthCredentials,
	code: string,
): Promise<{
	accessToken: string
	refreshToken: null
	expiresAt: Date
	workspaceId: string
	workspaceName: string
	email: string | null
}> {
	const data = await exchangeToken(
		TOKEN_URL,
		{
			grant_type: "authorization_code",
			code,
			redirect_uri: creds.redirectUri,
		},
		{
			basicAuth: {
				username: creds.clientId,
				password: creds.clientSecret,
			},
		},
	)

	// Notion tokens don't expire (1 year+ lifetime), set far future
	const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

	const owner = data.owner as
		| { user?: { person?: { email?: string } } }
		| undefined

	return {
		accessToken: data.access_token as string,
		refreshToken: null, // Notion doesn't use refresh tokens
		expiresAt,
		workspaceId: (data.workspace_id as string) ?? "",
		workspaceName: (data.workspace_name as string) ?? "",
		email: owner?.user?.person?.email ?? null,
	}
}
