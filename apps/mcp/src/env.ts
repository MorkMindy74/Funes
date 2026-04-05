import { z } from "zod"

export const mcpEnvSchema = z.object({
	API_URL: z.string().url().optional(),
	POSTHOG_API_KEY: z.string().optional(),
})

export type McpEnv = z.infer<typeof mcpEnvSchema>
