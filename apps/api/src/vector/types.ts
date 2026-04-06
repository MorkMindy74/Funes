/**
 * VectorBackend — Pluggable interface for vector storage.
 *
 * Implementations:
 * - LanceDB (default, embedded, zero dependencies)
 * - LEANN (optional microservice, 97% storage reduction)
 */

export interface ChunkRecord {
	id: string
	documentId: string
	content: string
	embedding: number[]
}

export interface MemoryRecord {
	id: string
	memory: string
	spaceId: string
	embedding: number[]
	agentId?: string
	sessionId?: string
}

export interface ChunkSearchResult {
	id: string
	documentId: string
	content: string
	score: number
}

export interface MemorySearchResult {
	id: string
	memory: string
	spaceId: string
	score: number
	agentId?: string
	sessionId?: string
}

export interface SearchOptions {
	limit?: number
	filter?: string
}

export interface VectorBackend {
	name: string

	// Index operations
	indexChunks(chunks: ChunkRecord[]): Promise<void>
	indexMemories(memories: MemoryRecord[]): Promise<void>

	// Search operations
	searchChunks(queryVector: number[], options?: SearchOptions): Promise<ChunkSearchResult[]>
	searchMemories(queryVector: number[], options?: SearchOptions): Promise<MemorySearchResult[]>

	// Delete operations
	deleteDocumentChunks(documentId: string): Promise<void>
}
