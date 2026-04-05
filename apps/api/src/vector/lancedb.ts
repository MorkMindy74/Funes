/**
 * LanceDB embedded vector store — stores embeddings on local disk.
 * Zero external server, pure TypeScript, handles millions of vectors.
 */

import { env } from "../env.js"
import { logger } from "../logger.js"
import { getEmbeddingDimension } from "../processing/embeddings.js"

let dbInstance: any = null

/** Lazy-initialize LanceDB connection */
async function getDb() {
	if (dbInstance) return dbInstance

	const lancedb = await import("vectordb")
	dbInstance = await lancedb.connect(env.LANCEDB_DIR)
	logger.info({ path: env.LANCEDB_DIR }, "LanceDB connected")
	return dbInstance
}

/** Ensure the chunks table exists */
async function getChunksTable() {
	const db = await getDb()

	try {
		return await db.openTable("chunks")
	} catch {
		// Create table with schema
		const dim = getEmbeddingDimension()
		return await db.createTable("chunks", [
			{
				id: "init",
				documentId: "init",
				content: "",
				vector: new Array(dim).fill(0),
			},
		])
	}
}

/** Ensure the memories table exists */
async function getMemoriesTable() {
	const db = await getDb()

	try {
		return await db.openTable("memories")
	} catch {
		const dim = getEmbeddingDimension()
		return await db.createTable("memories", [
			{
				id: "init",
				memory: "",
				spaceId: "",
				vector: new Array(dim).fill(0),
			},
		])
	}
}

/** Add chunk embeddings to LanceDB */
export async function indexChunks(
	chunks: Array<{
		id: string
		documentId: string
		content: string
		embedding: number[]
	}>,
): Promise<void> {
	if (chunks.length === 0) return

	const table = await getChunksTable()
	await table.add(
		chunks.map((c) => ({
			id: c.id,
			documentId: c.documentId,
			content: c.content,
			vector: c.embedding,
		})),
	)

	logger.debug({ count: chunks.length }, "Chunks indexed in LanceDB")
}

/** Add memory embeddings to LanceDB */
export async function indexMemories(
	memories: Array<{
		id: string
		memory: string
		spaceId: string
		embedding: number[]
	}>,
): Promise<void> {
	if (memories.length === 0) return

	const table = await getMemoriesTable()
	await table.add(
		memories.map((m) => ({
			id: m.id,
			memory: m.memory,
			spaceId: m.spaceId,
			vector: m.embedding,
		})),
	)

	logger.debug({ count: memories.length }, "Memories indexed in LanceDB")
}

/** Search chunks by vector similarity */
export async function searchChunks(
	queryVector: number[],
	options: { limit?: number; filter?: string } = {},
): Promise<Array<{ id: string; documentId: string; content: string; score: number }>> {
	const table = await getChunksTable()

	let query = table.search(queryVector).limit(options.limit ?? 10)
	if (options.filter) {
		query = query.where(options.filter)
	}

	const results = await query.execute()

	return results
		.filter((r: any) => r.id !== "init")
		.map((r: any) => ({
			id: r.id,
			documentId: r.documentId,
			content: r.content,
			score: 1 - (r._distance ?? 0), // LanceDB returns distance, we want similarity
		}))
}

/** Search memories by vector similarity */
export async function searchMemories(
	queryVector: number[],
	options: { limit?: number; filter?: string } = {},
): Promise<Array<{ id: string; memory: string; spaceId: string; score: number }>> {
	const table = await getMemoriesTable()

	let query = table.search(queryVector).limit(options.limit ?? 10)
	if (options.filter) {
		query = query.where(options.filter)
	}

	const results = await query.execute()

	return results
		.filter((r: any) => r.id !== "init")
		.map((r: any) => ({
			id: r.id,
			memory: r.memory,
			spaceId: r.spaceId,
			score: 1 - (r._distance ?? 0),
		}))
}

/** Delete all chunks for a document */
export async function deleteDocumentChunks(documentId: string): Promise<void> {
	try {
		const table = await getChunksTable()
		await table.delete(`documentId = "${documentId}"`)
	} catch {
		// Table may not exist yet
	}
}
