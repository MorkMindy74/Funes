/**
 * LLM-based reranker — uses Ollama to score query-document relevance.
 *
 * Sends batches of results to the LLM with a scoring prompt.
 * Each result gets a 0.0-1.0 relevance score extracted via regex.
 * Inspired by Mem0's LLMReranker pattern.
 */

import { env } from "../../env.js"
import { logger } from "../../logger.js"
import type { Reranker, RerankInput, RerankOutput } from "./types.js"

const BATCH_SIZE = 10
const TIMEOUT_MS = 30_000
const FALLBACK_SCORE = 0.5
const SCORE_REGEX = /\b([01](?:\.\d+)?)\b/g

export class LLMReranker implements Reranker {
	name = "llm"

	async rerank(
		query: string,
		results: RerankInput[],
		topK: number,
	): Promise<RerankOutput[]> {
		if (!env.OLLAMA_URL) {
			logger.warn("LLM reranker requires OLLAMA_URL — returning original order")
			return results.slice(0, topK).map((r) => ({ ...r, rerankedScore: r.score }))
		}

		const scored: RerankOutput[] = []

		// Process in batches to avoid oversized prompts
		for (let i = 0; i < results.length; i += BATCH_SIZE) {
			const batch = results.slice(i, i + BATCH_SIZE)
			const batchScores = await this.scoreBatch(query, batch)
			scored.push(...batchScores)
		}

		return scored
			.sort((a, b) => b.rerankedScore - a.rerankedScore)
			.slice(0, topK)
	}

	private async scoreBatch(
		query: string,
		batch: RerankInput[],
	): Promise<RerankOutput[]> {
		const numbered = batch
			.map((r, i) => `[${i}] ${r.content.slice(0, 500)}`)
			.join("\n\n")

		const prompt = `You are a relevance scorer. Given a query and a list of text passages, rate each passage's relevance to the query on a scale of 0.0 to 1.0.

Query: "${query}"

Passages:
${numbered}

Return ONLY a JSON array of scores in order, one per passage. Example for 3 passages: [0.9, 0.3, 0.7]
Return ONLY the JSON array, nothing else.`

		try {
			const response = await fetch(`${env.OLLAMA_URL}/api/generate`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: env.OLLAMA_MODEL,
					prompt,
					stream: false,
					options: { temperature: 0, num_predict: 200 },
				}),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			})

			if (!response.ok) {
				throw new Error(`Ollama returned ${response.status}`)
			}

			const data = (await response.json()) as { response?: string }
			const text = data.response ?? ""

			// Try JSON array parse first
			const scores = this.parseScores(text, batch.length)

			return batch.map((r, i) => ({
				id: r.id,
				score: r.score,
				rerankedScore: scores[i] ?? FALLBACK_SCORE,
			}))
		} catch (err) {
			logger.warn({ err, batchSize: batch.length }, "LLM reranker batch failed — using fallback scores")
			return batch.map((r) => ({
				id: r.id,
				score: r.score,
				rerankedScore: FALLBACK_SCORE,
			}))
		}
	}

	private parseScores(text: string, expected: number): number[] {
		// Try JSON array parse
		try {
			const trimmed = text.trim()
			const jsonMatch = trimmed.match(/\[[\d.,\s]+\]/)
			if (jsonMatch) {
				const arr = JSON.parse(jsonMatch[0]) as number[]
				if (Array.isArray(arr) && arr.length >= expected) {
					return arr.slice(0, expected).map((n) => Math.max(0, Math.min(1, Number(n) || FALLBACK_SCORE)))
				}
			}
		} catch {
			// Fall through to regex
		}

		// Fallback: extract all decimal numbers 0-1
		const matches = [...text.matchAll(SCORE_REGEX)]
			.map((m) => Number.parseFloat(m[1]))
			.filter((n) => n >= 0 && n <= 1)

		if (matches.length >= expected) {
			return matches.slice(0, expected)
		}

		// Not enough scores — pad with fallback
		return Array.from({ length: expected }, (_, i) => matches[i] ?? FALLBACK_SCORE)
	}
}
