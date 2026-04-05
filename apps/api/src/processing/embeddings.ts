/**
 * Local embedding generation using @xenova/transformers (pure JS/WASM).
 * No Python, no external API, runs on any machine.
 *
 * Default model: Xenova/all-MiniLM-L6-v2 (384 dimensions, ~80MB)
 * Configurable via EMBEDDING_MODEL env var.
 */

import { env } from "../env.js"
import { logger } from "../logger.js"

let pipeline: any = null
let modelName = ""

/**
 * Lazy-load the embedding pipeline.
 * First call downloads the model (~80MB), subsequent calls reuse it.
 */
async function getEmbeddingPipeline() {
	if (pipeline && modelName === env.EMBEDDING_MODEL) return pipeline

	logger.info({ model: env.EMBEDDING_MODEL }, "Loading embedding model (first time may take a moment)...")

	try {
		// Dynamic import — @xenova/transformers is ESM-only
		const { pipeline: createPipeline } = await import("@xenova/transformers")
		pipeline = await createPipeline("feature-extraction", env.EMBEDDING_MODEL, {
			quantized: true, // Use quantized model for speed
		})
		modelName = env.EMBEDDING_MODEL
		logger.info({ model: env.EMBEDDING_MODEL }, "Embedding model loaded successfully")
		return pipeline
	} catch (err) {
		logger.error({ err, model: env.EMBEDDING_MODEL }, "Failed to load embedding model")
		throw err
	}
}

/**
 * Generate embedding vector for a single text.
 * Returns a float32 array of dimension 384 (for MiniLM-L6-v2).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
	const embed = await getEmbeddingPipeline()

	const output = await embed(text, {
		pooling: "mean",
		normalize: true,
	})

	// Convert Tensor to plain array
	return Array.from(output.data as Float32Array)
}

/**
 * Generate embeddings for multiple texts in batch.
 * More efficient than calling generateEmbedding() in a loop.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return []

	const embed = await getEmbeddingPipeline()
	const results: number[][] = []

	// Process in batches of 32 for memory efficiency
	const BATCH_SIZE = 32
	for (let i = 0; i < texts.length; i += BATCH_SIZE) {
		const batch = texts.slice(i, i + BATCH_SIZE)

		for (const text of batch) {
			const output = await embed(text, {
				pooling: "mean",
				normalize: true,
			})
			results.push(Array.from(output.data as Float32Array))
		}
	}

	return results
}

/** Get the dimension of the current embedding model */
export function getEmbeddingDimension(): number {
	// MiniLM-L6-v2 = 384, bge-large-en = 1024
	if (env.EMBEDDING_MODEL.includes("MiniLM-L6")) return 384
	if (env.EMBEDDING_MODEL.includes("bge-large")) return 1024
	if (env.EMBEDDING_MODEL.includes("bge-base")) return 768
	return 384 // default
}

/** Get the model name for metadata storage */
export function getEmbeddingModelName(): string {
	return env.EMBEDDING_MODEL
}
