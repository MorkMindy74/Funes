import { z } from "zod"
import { createEnvValidator } from "@repo/lib/env"

const webEnvSchema = z.object({
	NEXT_PUBLIC_BACKEND_URL: z
		.string()
		.url()
		.default("https://api.supermemory.ai"),
	NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
	EXA_API_KEY: z.string().min(1, "EXA_API_KEY is required").optional(),
	XAI_API_KEY: z.string().optional(),
})

export type WebEnv = z.infer<typeof webEnvSchema>

export const env = createEnvValidator(webEnvSchema)
