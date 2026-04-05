import { getSessionCookie } from "better-auth/cookies"
import { NextResponse } from "next/server"

const ALLOWED_ORIGINS = [
	"https://app.supermemory.ai",
	"https://supermemory.ai",
	process.env.NEXT_PUBLIC_APP_URL,
].filter(Boolean) as string[]

function isOriginAllowed(origin: string | null): boolean {
	if (!origin) return false
	if (ALLOWED_ORIGINS.some((allowed) => origin === allowed)) return true
	// Allow localhost in development
	if (origin.startsWith("http://localhost:")) return true
	return false
}

export default async function proxy(request: Request) {
	console.debug("[PROXY] === PROXY START ===")
	const url = new URL(request.url)

	console.debug("[PROXY] Path:", url.pathname)
	console.debug("[PROXY] Method:", request.method)

	const sessionCookie = getSessionCookie(request)
	console.debug("[PROXY] Session cookie exists:", !!sessionCookie)

	// Always allow access to login and waitlist pages
	const publicPaths = ["/login", "/login/new"]
	if (publicPaths.includes(url.pathname)) {
		console.debug("[PROXY] Public path, allowing access")
		return NextResponse.next()
	}

	if (url.pathname.startsWith("/api/")) {
		if (!sessionCookie) {
			console.debug("[MIDDLEWARE] API route without session, returning 401")
			return new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			})
		}

		// CSRF protection for mutating requests
		// Exempt /api/auth/* (better-auth handles its own CSRF) and /api/emails/* (webhooks)
		const method = request.method.toUpperCase()
		if (
			["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
			!url.pathname.startsWith("/api/auth/") &&
			!url.pathname.startsWith("/api/emails/")
		) {
			const origin = request.headers.get("origin")
			const referer = request.headers.get("referer")
			const refererOrigin = referer ? new URL(referer).origin : null

			if (!isOriginAllowed(origin) && !isOriginAllowed(refererOrigin)) {
				console.debug("[MIDDLEWARE] CSRF check failed for:", url.pathname)
				return new Response(
					JSON.stringify({ error: "CSRF validation failed" }),
					{
						status: 403,
						headers: { "Content-Type": "application/json" },
					},
				)
			}
		}

		console.debug("[MIDDLEWARE] API route with session, allowing access")
		return NextResponse.next()
	}

	// If no session cookie and not on a public path, redirect to login
	if (!sessionCookie) {
		console.debug(
			"[PROXY] No session cookie and not on public path, redirecting to /login",
		)
		const url = new URL("/login", request.url)
		url.searchParams.set("redirect", request.url)
		return NextResponse.redirect(url)
	}

	console.debug("[PROXY] Passing through to next handler")
	console.debug("[PROXY] === PROXY END ===")
	const response = NextResponse.next()
	response.cookies.set({
		name: "last-site-visited",
		value: "https://app.supermemory.ai",
		domain: "supermemory.ai",
	})
	return response
}

export const config = {
	matcher: [
		"/((?!_next/static|_next/image|images|icon.png|monitoring|opengraph-image.png|bg-rectangle.png|onboarding|ingest|login|api/emails).*)",
	],
}
