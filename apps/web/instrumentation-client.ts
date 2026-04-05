// This file configures the initialization of Sentry on the client.
// Sentry is OPTIONAL — only active when NEXT_PUBLIC_SENTRY_DSN is set.

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN

if (SENTRY_DSN) {
	import("@sentry/nextjs").then((Sentry) => {
		function sentryShouldDropExpectedNonActionableError(event: {
			message?: string
			exception?: { values?: Array<{ type?: string; value?: string }> }
		}): boolean {
			const patterns = [
				/user location is not supported/i,
				/this email domain is not allowed/i,
			]
			const matches = (s: string | undefined) =>
				s != null && patterns.some((re) => re.test(s))

			if (matches(event.message)) return true
			for (const ex of event.exception?.values ?? []) {
				if (matches(ex.value)) return true
			}
			return false
		}

		Sentry.init({
			dsn: SENTRY_DSN,
			integrations: [Sentry.replayIntegration()],
			tracesSampleRate: 1,
			enableLogs: true,
			replaysSessionSampleRate: 0.1,
			replaysOnErrorSampleRate: 1.0,
			debug: false,
			beforeSend(event) {
				if (sentryShouldDropExpectedNonActionableError(event)) return null
				return event
			},
		})
	})
}

// No-op export when Sentry is not loaded
export const onRouterTransitionStart = SENTRY_DSN
	? (...args: unknown[]) => {
			import("@sentry/nextjs").then((Sentry) => {
				Sentry.captureRouterTransitionStart(...(args as [any]))
			})
		}
	: () => {}
