/**
 * Vector Backend Facade — pluggable vector storage.
 *
 * Default: LanceDB (embedded, zero dependencies)
 * Optional: LEANN (microservice, 97% storage reduction)
 *
 * Switch via: VECTOR_BACKEND=leann (+ LEANN_URL)
 *
 * All consumers import from this file. The backend is selected once
 * at startup and reused for all operations.
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

// Re-export types for convenience
export type {
	ChunkRecord,
	MemoryRecord,
	ChunkSearchResult,
	MemorySearchResult,
	SearchOptions,
	VectorBackend,
}

let backend: VectorBackend | null = null

/** Lazy-initialize the vector backend based on config */
async function getBackend(): Promise<VectorBackend> {
	if (backend) return backend

	if (env.VECTOR_BACKEND === "leann" && env.LEANN_URL) {
		const { LeannBackend, isLeannAvailable } = await import("./leann.js")
		const available = await isLeannAvailable()

		if (available) {
			backend = new LeannBackend()
			logger.info({ url: env.LEANN_URL }, "Vector backend: LEANN")
		} else {
			logger.warn(
				"VECTOR_BACKEND=leann but LEANN service not reachable — falling back to LanceDB",
			)
			backend = await loadLanceDB()
		}
	} else {
		backend = await loadLanceDB()
	}

	return backend
}

async function loadLanceDB(): Promise<VectorBackend> {
	const lancedb = await import("./lancedb.js")
	logger.info({ path: env.LANCEDB_DIR }, "Vector backend: LanceDB (embedded)")

	return {
		name: "lancedb",
		indexChunks: lancedb.indexChunks,
		indexMemories: lancedb.indexMemories,
		searchChunks: lancedb.searchChunks,
		searchMemories: lancedb.searchMemories,
		deleteDocumentChunks: lancedb.deleteDocumentChunks,
	}
}

// ─── Public API (same signatures as before) ───────────────────────

export async function indexChunks(chunks: ChunkRecord[]): Promise<void> {
	return (await getBackend()).indexChunks(chunks)
}

export async function indexMemories(memories: MemoryRecord[]): Promise<void> {
	return (await getBackend()).indexMemories(memories)
}

export async function searchChunks(
	queryVector: number[],
	options?: SearchOptions,
): Promise<ChunkSearchResult[]> {
	return (await getBackend()).searchChunks(queryVector, options)
}

export async function searchMemories(
	queryVector: number[],
	options?: SearchOptions,
): Promise<MemorySearchResult[]> {
	return (await getBackend()).searchMemories(queryVector, options)
}

export async function deleteDocumentChunks(documentId: string): Promise<void> {
	return (await getBackend()).deleteDocumentChunks(documentId)
}

/** Get the name of the active vector backend */
export async function getBackendName(): Promise<string> {
	return (await getBackend()).name
}
