/**
 * Environment variable validation utilities.
 *
 * Uses Zod to validate and type environment variables at startup,
 * replacing silent fallbacks with explicit validation errors.
 */

import type { z } from "zod"

/**
 * Create a validated environment object from a Zod schema.
 * Throws a descriptive error if required variables are missing or invalid.
 *
 * @param schema - Zod schema defining expected env vars
 * @param env - Environment object to validate (defaults to process.env)
 */
export function createEnvValidator<T extends z.ZodObject<z.ZodRawShape>>(
	schema: T,
	env: Record<string, string | undefined> = typeof process !== "undefined"
		? process.env
		: {},
): z.infer<T> {
	const result = schema.safeParse(env)

	if (!result.success) {
		const errors = result.error.issues
			.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
			.join("\n")
		throw new Error(`Environment validation failed:\n${errors}`)
	}

	return result.data
}
