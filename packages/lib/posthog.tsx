"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect } from "react"
import { useSession } from "./auth"

// Lazy-load posthog only when configured
let posthogInstance: any = null
let posthogLoaded = false

function getPostHog() {
	return posthogInstance
}

function PostHogPageTracking() {
	const pathname = usePathname()
	const searchParams = useSearchParams()

	useEffect(() => {
		const ph = getPostHog()
		if (pathname && ph?.__loaded) {
			let url = window.origin + pathname
			if (searchParams.toString()) {
				url = `${url}?${searchParams.toString()}`
			}
			ph.capture("$pageview", {
				$current_url: url,
				path: pathname,
				search_params: searchParams.toString(),
			})
		}
	}, [pathname, searchParams])

	return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
	const { data: session } = useSession()

	useEffect(() => {
		if (typeof window === "undefined") return
		const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
		if (!posthogKey) return

		// Dynamic import — PostHog only loaded if key is set
		import("posthog-js").then((mod) => {
			const posthog = mod.default
			const backendUrl =
				process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"

			posthog.init(posthogKey, {
				api_host: `${backendUrl}/orange`,
				ui_host: "https://us.i.posthog.com",
				person_profiles: "identified_only",
				capture_pageview: false,
				capture_pageleave: true,
				loaded: (ph: any) => ph.register({ app: "app" }),
			})

			posthogInstance = posthog
			posthogLoaded = true
		})
	}, [])

	// User identification
	useEffect(() => {
		const ph = getPostHog()
		if (session?.user && ph?.__loaded) {
			ph.identify(session.user.id, {
				email: session.user.email,
				name: session.user.name,
				userId: session.user.id,
				createdAt: session.user.createdAt,
			})
		}
	}, [session?.user])

	return (
		<>
			<Suspense fallback={null}>
				{process.env.NODE_ENV === "production" &&
					process.env.NEXT_PUBLIC_POSTHOG_KEY && <PostHogPageTracking />}
			</Suspense>
			{children}
		</>
	)
}

export function usePostHog() {
	return (
		getPostHog() || {
			__loaded: false,
			capture: () => {},
			identify: () => {},
			register: () => {},
		}
	)
}
