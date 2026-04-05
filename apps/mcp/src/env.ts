import { z } from "zod"

const envSchema = z.object({
  PORT: z.coerce.number().default(3002),
  API_URL: z.string().url().default("http://localhost:3001"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
})

export const env = envSchema.parse(process.env)
