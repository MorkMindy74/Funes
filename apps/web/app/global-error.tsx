"use client"

import NextError from "next/error"
import { useEffect } from "react"

export default function GlobalError({
	error,
}: {
	error: Error & { digest?: string }
}) {
	useEffect(() => {
		if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
			import("@sentry/nextjs").then((Sentry) => {
				Sentry.captureException(error)
			})
		} else {
			console.error("Unhandled error:", error)
		}
	}, [error])

	return (
		<html lang="en">
			<body>
				<NextError statusCode={0} />
			</body>
		</html>
	)
}
