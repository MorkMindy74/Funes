import { betterAuth } from "better-auth"
import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import {
	admin,
	anonymous,
	emailOTP,
	organization,
	username,
} from "better-auth/plugins"
import { db } from "../db/index.js"
import { env } from "../env.js"
import { logger } from "../logger.js"

export const auth = betterAuth({
	database: drizzleAdapter(db, { provider: "pg" }),
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	trustedOrigins: [env.FRONTEND_URL, env.BETTER_AUTH_URL],

	emailAndPassword: {
		enabled: true,
	},

	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // 5 minutes
		},
	},

	plugins: [
		username(),
		emailOTP({
			async sendVerificationOTP({ email, otp }) {
				// Self-hosted: log OTP to console (user can configure SMTP later)
				logger.info({ email, otp }, "Email OTP verification code")
			},
		}),
		admin(),
		organization(),
		anonymous(),
	],

	advanced: {
		crossSubDomainCookies: {
			enabled: false,
		},
	},
})

export type Auth = typeof auth
