import { createAuthClient } from "better-auth/client"
import {
	adminClient,
	anonymousClient,
	apiKeyClient,
	emailOTPClient,
	magicLinkClient,
	organizationClient,
	usernameClient,
} from "better-auth/client/plugins"

export const middlewareAuthClient = createAuthClient({
	baseURL: process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001",
	fetchOptions: {
		throw: true,
	},
	plugins: [
		usernameClient(),
		magicLinkClient(),
		emailOTPClient(),
		apiKeyClient(),
		adminClient(),
		organizationClient(),
		anonymousClient(),
	],
})
