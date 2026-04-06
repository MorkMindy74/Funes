/**
 * Cross-encoder reranker — re-scores results using embedding similarity.
 *
 * Generates embeddings for both the query and each result's content,
 * then computes cosine similarity as the reranked score.
 * Fast and local — no LLM call, uses the existing @xenova/transformers pipeline.
 */

import { generateEmbedding, generateEmbeddings } from "../embeddings.js"
import { logger } from "../../logger.js"
import type { Reranker, RerankInput, RerankOutput } from "./types.js"

export class CrossEncoderReranker implements Reranker {
	name = "cross-encoder"

	async rerank(
		query: string,
		results: RerankInput[],
		topK: number,
	): Promise<RerankOutput[]> {
		try {
			// Generate query embedding
			const queryEmb = await generateEmbedding(query)

			// Generate embeddings for all result contents in batch
			const contents = results.map((r) => r.content.slice(0, 1000))
			const contentEmbs = await generateEmbeddings(contents)

			// Compute cosine similarity for each
			const scored: RerankOutput[] = results.map((r, i) => ({
				id: r.id,
				score: r.score,
				rerankedScore: cosineSimilarity(queryEmb, contentEmbs[i]),
			}))

			return scored
				.sort((a, b) => b.rerankedScore - a.rerankedScore)
				.slice(0, topK)
		} catch (err) {
			logger.warn({ err }, "Cross-encoder reranker failed — returning original order")
			return results.slice(0, topK).map((r) => ({ ...r, rerankedScore: r.score }))
		}
	}
}

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0

	let dot = 0
	let normA = 0
	let normB = 0

	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}

	const denom = Math.sqrt(normA) * Math.sqrt(normB)
	return denom === 0 ? 0 : dot / denom
}
