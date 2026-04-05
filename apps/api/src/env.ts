/** Environment configuration with sensible defaults for self-hosted */
export const env = {
	// Server
	PORT: Number(process.env.PORT ?? 3001),
	NODE_ENV: process.env.NODE_ENV ?? "development",

	// Database
	DATABASE_URL:
		process.env.DATABASE_URL ?? "postgres://funes:funes_dev@localhost:5432/funes",

	// Redis (for BullMQ)
	REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",

	// Auth
	BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "change-me-in-production",
	BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",

	// Frontend
	FRONTEND_URL: process.env.FRONTEND_URL ?? "http://localhost:3000",

	// Storage
	UPLOAD_DIR: process.env.UPLOAD_DIR ?? "./data/uploads",
	LANCEDB_DIR: process.env.LANCEDB_DIR ?? "./data/lancedb",

	// Optional: Ollama for LLM features
	OLLAMA_URL: process.env.OLLAMA_URL ?? "",
	OLLAMA_MODEL: process.env.OLLAMA_MODEL ?? "llama3.2",

	// Optional: Embedding model
	EMBEDDING_MODEL: process.env.EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2",

	// Optional: External services (M7+)
	FIRECRAWL_URL: process.env.FIRECRAWL_URL ?? "",
	OCR_PROVIDER: process.env.OCR_PROVIDER ?? "", // "glm-ocr" | "chandra" | ""
	CHANDRA_URL: process.env.CHANDRA_URL ?? "",
	GRAPHITI_URL: process.env.GRAPHITI_URL ?? "",

	// Optional monitoring (disabled by default)
	SENTRY_DSN: process.env.SENTRY_DSN ?? "",
} as const
