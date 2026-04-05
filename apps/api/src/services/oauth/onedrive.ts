/**
 * OneDrive/Microsoft OAuth — Authorization, token exchange, user info.
 */

import type { OAuthCredentials, StateData } from "./common.js"
import { generatePKCE, generateState, exchangeToken } from "./common.js"

const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
const USERINFO_URL = "https://graph.microsoft.com/v1.0/me"
const SCOPES = "Files.Read.All User.Read offline_access"

/** Build Microsoft OAuth authorization URL */
export function getAuthUrl(
	creds: OAuthCredentials,
	stateData: Omit<StateData, "codeVerifier" | "provider">,
): { authLink: string; state: string } {
	const { codeVerifier, codeChallenge } = generatePKCE()

	const state = generateState({
		...stateData,
		provider: "onedrive",
		codeVerifier,
	})

	const params = new URLSearchParams({
		client_id: creds.clientId,
		redirect_uri: creds.redirectUri,
		response_type: "code",
		scope: SCOPES,
		state,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	})

	return {
		authLink: `${AUTH_URL}?${params.toString()}`,
		state,
	}
}

/** Exchange authorization code for tokens */
export async function exchangeCode(
	creds: OAuthCredentials,
	code: string,
	codeVerifier: string,
): Promise<{
	accessToken: string
	refreshToken: string | null
	expiresAt: Date
}> {
	const data = await exchangeToken(TOKEN_URL, {
		client_id: creds.clientId,
		client_secret: creds.clientSecret,
		redirect_uri: creds.redirectUri,
		grant_type: "authorization_code",
		code,
		code_verifier: codeVerifier,
		scope: SCOPES,
	})

	const expiresIn = (data.expires_in as number) ?? 3600

	return {
		accessToken: data.access_token as string,
		refreshToken: (data.refresh_token as string) ?? null,
		expiresAt: new Date(Date.now() + expiresIn * 1000),
	}
}

/** Get user email from Microsoft Graph */
export async function getUserInfo(
	accessToken: string,
): Promise<{ email: string }> {
	const resp = await fetch(USERINFO_URL, {
		headers: { Authorization: `Bearer ${accessToken}` },
		signal: AbortSignal.timeout(10000),
	})

	if (!resp.ok) throw new Error(`Microsoft userinfo failed: ${resp.status}`)
	const data = (await resp.json()) as {
		mail?: string
		userPrincipalName?: string
	}
	return { email: data.mail || data.userPrincipalName || "" }
}

/** Refresh token URL for Microsoft */
export const ONEDRIVE_TOKEN_URL = TOKEN_URL
