import type { Context, Next } from "hono"
import { auth } from "../auth/index.js"

export type AuthUser = {
	id: string
	email: string
	name: string | null
}

export type AuthSession = {
	user: AuthUser
	orgId: string
}

/**
 * Auth middleware — validates session cookie or API key.
 * Sets c.set("session", { user, orgId }) for downstream handlers.
 */
export async function authMiddleware(c: Context, next: Next) {
	try {
		const session = await auth.api.getSession({
			headers: c.req.raw.headers,
		})

		if (!session?.user) {
			return c.json({ error: "Unauthorized" }, 401)
		}

		// Get active organization (default to first org)
		let orgId = c.req.header("x-org-id") ?? ""

		if (!orgId) {
			// Try to get the user's active organization
			const orgs = await auth.api.listOrganizations({
				headers: c.req.raw.headers,
			})
			if (orgs && orgs.length > 0) {
				orgId = orgs[0].id
			} else {
				// Auto-create a personal org for the user
				const newOrg = await auth.api.createOrganization({
					body: {
						name: `${session.user.name ?? session.user.email}'s Space`,
						slug: `user-${session.user.id.slice(0, 8)}`,
					},
					headers: c.req.raw.headers,
				})
				orgId = newOrg.id
			}
		}

		c.set("session", {
			user: {
				id: session.user.id,
				email: session.user.email,
				name: session.user.name,
			},
			orgId,
		} satisfies AuthSession)

		await next()
	} catch {
		return c.json({ error: "Unauthorized" }, 401)
	}
}

/** Helper to get typed session from context */
export function getSession(c: Context): AuthSession {
	return c.get("session") as AuthSession
}
