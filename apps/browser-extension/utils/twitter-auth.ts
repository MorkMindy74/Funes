/**
 * Twitter Authentication Module
 * Handles token capture and storage for Twitter API access
 */
import {
	getTokensLogged,
	setTokensLogged,
	setTwitterTokens,
	type TwitterAuthTokens,
} from "./storage"

/**
 * Validates that captured tokens match expected formats
 */
function validateTokenFormats(tokens: {
	auth: string
	csrf: string
	cookie: string
}): boolean {
	// Auth should be a Bearer token
	if (!tokens.auth.startsWith("Bearer ")) {
		console.warn("Twitter auth token does not match Bearer format")
		return false
	}

	// CSRF token should be a non-empty hex-like string
	if (!/^[a-f0-9]{32,}$/i.test(tokens.csrf)) {
		console.warn("Twitter CSRF token does not match expected format")
		return false
	}

	// Cookie should contain the ct0 CSRF cookie
	if (!tokens.cookie.includes("ct0=")) {
		console.warn("Twitter cookie missing ct0 CSRF cookie")
		return false
	}

	return true
}

/**
 * Captures Twitter authentication tokens from web request headers
 * @param details - Web request details containing headers
 * @returns True if tokens were captured, false otherwise
 */
export async function captureTwitterTokens(
	details: chrome.webRequest.WebRequestDetails & {
		requestHeaders?: chrome.webRequest.HttpHeader[]
	},
): Promise<boolean> {
	if (!(details.url.includes("x.com") || details.url.includes("twitter.com"))) {
		return false
	}

	let authHeader: chrome.webRequest.HttpHeader | undefined
	let cookieHeader: chrome.webRequest.HttpHeader | undefined
	let csrfHeader: chrome.webRequest.HttpHeader | undefined

	if (details.requestHeaders) {
		for (const header of details.requestHeaders) {
			if (!header.name) continue
			const name = header.name.toLowerCase()

			switch (name) {
				case "authorization":
					authHeader = header
					break
				case "cookie":
					cookieHeader = header
					break
				case "x-csrf-token":
					csrfHeader = header
					break
			}

			if (authHeader && cookieHeader && csrfHeader) break
		}
	}

	if (authHeader?.value && cookieHeader?.value && csrfHeader?.value) {
		if (
			!validateTokenFormats({
				auth: authHeader.value,
				csrf: csrfHeader.value,
				cookie: cookieHeader.value,
			})
		) {
			return false
		}

		const tokensAlreadyLogged = await getTokensLogged()
		if (!tokensAlreadyLogged) {
			console.log("Twitter auth tokens captured successfully")
			await setTokensLogged()
		}

		await setTwitterTokens({
			cookie: cookieHeader.value,
			csrf: csrfHeader.value,
			auth: authHeader.value,
		})

		return true
	}

	return false
}

/**
 * Creates HTTP headers for Twitter API requests using stored tokens
 * @param tokens - Twitter authentication tokens
 * @returns Headers object ready for fetch requests
 */
export function createTwitterAPIHeaders(tokens: TwitterAuthTokens): Headers {
	const headers = new Headers()
	headers.append("Cookie", tokens.cookie)
	headers.append("X-Csrf-Token", tokens.csrf)
	headers.append("Authorization", tokens.auth)
	headers.append("Content-Type", "application/json")
	headers.append(
		"User-Agent",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
	)
	headers.append("Accept", "*/*")
	headers.append("Accept-Language", "en-US,en;q=0.9")
	return headers
}
