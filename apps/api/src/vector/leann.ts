/**
 * LEANN Vector Backend — HTTP client for the LEANN microservice.
 *
 * LEANN provides 97% storage reduction for vector embeddings.
 * Start with: docker compose --profile with-leann up
 *
 * Requires: VECTOR_BACKEND=leann and LEANN_URL in environment.
 */

import type {
	VectorBackend,
	ChunkRecord,
	MemoryRecord,
	ChunkSearchResult,
	MemorySearchResult,
	SearchOptions,
} from "./types.js"
import { env } from "../env.js"
import { logger } from "../logger.js"

export class LeannBackend implements VectorBackend {
	name = "leann"
	private baseUrl: string
	private apiKey: string | null

	constructor(url?: string, apiKey?: string) {
		this.baseUrl = (url || env.LEANN_URL).replace(/\/$/, "")
		this.apiKey = apiKey || env.LEANN_API_KEY || null
	}

	private headers(): Record<string, string> {
		const h: Record<string, string> = {
			"Content-Type": "application/json",
		}
		if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`
		return h
	}

	// ─── Index ────────────────────────────────────────────────────

	async indexChunks(chunks: ChunkRecord[]): Promise<void> {
		if (chunks.length === 0) return

		const resp = await fetch(`${this.baseUrl}/v1/index/chunks`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				vectors: chunks.map((c) => ({
					id: c.id,
					document_id: c.documentId,
					content: c.content,
					embedding: c.embedding,
				})),
			}),
			signal: AbortSignal.timeout(30000),
		})

		if (!resp.ok) {
			const err = await resp.text().catch(() => "")
			throw new Error(`LEANN indexChunks failed (${resp.status}): ${err}`)
		}

		logger.debug({ count: chunks.length }, "LEANN: chunks indexed")
	}

	async indexMemories(memories: MemoryRecord[]): Promise<void> {
		if (memories.length === 0) return

		const resp = await fetch(`${this.baseUrl}/v1/index/memories`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				vectors: memories.map((m) => ({
					id: m.id,
					memory: m.memory,
					space_id: m.spaceId,
					embedding: m.embedding,
					agent_id: m.agentId ?? undefined,
					session_id: m.sessionId ?? undefined,
				})),
			}),
			signal: AbortSignal.timeout(30000),
		})

		if (!resp.ok) {
			const err = await resp.text().catch(() => "")
			throw new Error(`LEANN indexMemories failed (${resp.status}): ${err}`)
		}

		logger.debug({ count: memories.length }, "LEANN: memories indexed")
	}

	// ─── Search ───────────────────────────────────────────────────

	async searchChunks(
		queryVector: number[],
		options: SearchOptions = {},
	): Promise<ChunkSearchResult[]> {
		const resp = await fetch(`${this.baseUrl}/v1/search/chunks`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				query_embedding: queryVector,
				limit: options.limit ?? 10,
				filter: options.filter ? parseFilter(options.filter) : undefined,
			}),
			signal: AbortSignal.timeout(10000),
		})

		if (!resp.ok) {
			const err = await resp.text().catch(() => "")
			logger.warn({ status: resp.status, err }, "LEANN searchChunks failed")
			return []
		}

		const data = (await resp.json()) as {
			results: Array<{
				id: string
				document_id: string
				content: string
				score: number
			}>
		}

		return (data.results ?? []).map((r) => ({
			id: r.id,
			documentId: r.document_id,
			content: r.content,
			score: r.score,
		}))
	}

	async searchMemories(
		queryVector: number[],
		options: SearchOptions = {},
	): Promise<MemorySearchResult[]> {
		const resp = await fetch(`${this.baseUrl}/v1/search/memories`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				query_embedding: queryVector,
				limit: options.limit ?? 10,
				filter: options.filter ? parseFilter(options.filter) : undefined,
			}),
			signal: AbortSignal.timeout(10000),
		})

		if (!resp.ok) {
			const err = await resp.text().catch(() => "")
			logger.warn({ status: resp.status, err }, "LEANN searchMemories failed")
			return []
		}

		const data = (await resp.json()) as {
			results: Array<{
				id: string
				memory: string
				space_id: string
				score: number
			}>
		}

		return (data.results ?? []).map((r) => ({
			id: r.id,
			memory: r.memory,
			spaceId: r.space_id,
			score: r.score,
		}))
	}

	// ─── Delete ───────────────────────────────────────────────────

	async deleteDocumentChunks(documentId: string): Promise<void> {
		try {
			const resp = await fetch(
				`${this.baseUrl}/v1/delete/document/${encodeURIComponent(documentId)}`,
				{
					method: "DELETE",
					headers: this.headers(),
					signal: AbortSignal.timeout(10000),
				},
			)
			if (!resp.ok) {
				logger.warn(
					{ documentId, status: resp.status },
					"LEANN deleteDocumentChunks failed",
				)
			}
		} catch {
			// Non-critical — log and continue
		}
	}
}

/** Parse LanceDB-style filter string into JSON filter for LEANN */
function parseFilter(filter: string): Record<string, string> | undefined {
	// LanceDB uses SQL-like: `spaceId = "xyz"` or `documentId = "abc"`
	const match = filter.match(/^(\w+)\s*=\s*"([^"]+)"$/)
	if (match) {
		return { [match[1]]: match[2] }
	}
	return undefined
}

/** Check if LEANN service is reachable */
export async function isLeannAvailable(url?: string): Promise<boolean> {
	const baseUrl = (url || env.LEANN_URL).replace(/\/$/, "")
	if (!baseUrl) return false

	try {
		const resp = await fetch(`${baseUrl}/health`, {
			signal: AbortSignal.timeout(3000),
		})
		return resp.ok
	} catch {
		return false
	}
}
