"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@lib/auth-context"

export function EnsureWorkspace({ children }: { children: React.ReactNode }) {
	const pathname = usePathname()
	const router = useRouter()
	const { session, organizations, isRestoring } = useAuth()

	useEffect(() => {
		if (isRestoring) return
		if (!session) {
			// Check if this is a fresh install (no users yet) → redirect to setup
			const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001"
			fetch(`${backendUrl}/setup/status`)
				.then((r) => r.json())
				.then((data: { initialized?: boolean }) => {
					if (!data.initialized) {
						router.replace("/setup")
					} else {
						router.replace(
							`/login?redirect=${encodeURIComponent(window.location.href)}`,
						)
					}
				})
				.catch(() => {
					router.replace(
						`/login?redirect=${encodeURIComponent(window.location.href)}`,
					)
				})
			return
		}
		if (organizations === null) return
		if (organizations.length > 0) return
		if (pathname.startsWith("/onboarding")) return
		router.replace("/onboarding/welcome?step=input")
	}, [session, organizations, isRestoring, pathname, router])

	return children
}
