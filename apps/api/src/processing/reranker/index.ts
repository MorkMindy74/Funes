/**
 * Reranker factory — lazy singleton based on RERANKER_PROVIDER env var.
 *
 * Returns null when provider is "none" (default), allowing callers to skip reranking.
 */

import { env } from "../../env.js"
import { logger } from "../../logger.js"
import type { Reranker } from "./types.js"

let cachedReranker: Reranker | null | undefined

/**
 * Get the configured reranker, or null if reranking is disabled.
 * Lazy-loaded singleton — safe to call from hot paths.
 */
export function getReranker(): Reranker | null {
	if (cachedReranker !== undefined) return cachedReranker

	const provider = env.RERANKER_PROVIDER

	switch (provider) {
		case "llm": {
			const { LLMReranker } = require("./llm-reranker.js") as typeof import("./llm-reranker.js")
			cachedReranker = new LLMReranker()
			logger.info("Reranker initialized: LLM (Ollama)")
			break
		}
		case "cross-encoder": {
			const { CrossEncoderReranker } = require("./cross-encoder-reranker.js") as typeof import("./cross-encoder-reranker.js")
			cachedReranker = new CrossEncoderReranker()
			logger.info("Reranker initialized: cross-encoder (bi-encoder similarity)")
			break
		}
		default:
			cachedReranker = null
			break
	}

	return cachedReranker
}

export type { Reranker, RerankInput, RerankOutput } from "./types.js"
