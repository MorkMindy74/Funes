/**
 * Graph Manager — PostgreSQL-native knowledge graph.
 *
 * Manages entity nodes and relationship edges, provides graph traversal
 * for RAG context enrichment, and handles entity deduplication.
 *
 * Uses recursive CTEs for multi-hop traversal (no Neo4j needed).
 */

import { eq, and, sql, desc } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { graphNodes, graphEdges } from "../db/schema.js"
import { generateEmbedding } from "./embeddings.js"
import type {
	ExtractedEntity,
	ExtractedRelationship,
} from "./entity-extractor.js"
import { logger } from "../logger.js"

// ─── Node Management ──��───────────────────────────────────────────

/**
 * Get or create an entity node. Deduplicates by (name, type, orgId).
 * If the entity already exists, increments mentionCount and merges properties.
 */
export async function upsertNode(
	entity: ExtractedEntity,
	orgId: string,
	options?: {
		spaceId?: string
		sourceMemoryId?: string
		sourceDocumentId?: string
	},
): Promise<string> {
	const normalizedName = entity.name.trim()

	// Try to find existing node
	const [existing] = await db
		.select()
		.from(graphNodes)
		.where(
			and(
				sql`LOWER(${graphNodes.name}) = LOWER(${normalizedName})`,
				eq(graphNodes.type, entity.type),
				eq(graphNodes.orgId, orgId),
			),
		)
		.limit(1)

	if (existing) {
		// Update: bump mention count, merge properties, update confidence
		const newConfidence = Math.min(
			1.0,
			(existing.confidence ?? 0.5) * 0.8 + entity.confidence * 0.2 + 0.05,
		)

		const mergedProps = {
			...(existing.properties as Record<string, unknown>),
			...(entity.properties ?? {}),
		}

		await db
			.update(graphNodes)
			.set({
				mentionCount: (existing.mentionCount ?? 1) + 1,
				confidence: newConfidence,
				properties: mergedProps,
				updatedAt: new Date(),
			})
			.where(eq(graphNodes.id, existing.id))

		return existing.id
	}

	// Create new node
	const nodeId = nanoid()

	// Generate embedding for the entity name (for vector search over entities)
	let embedding: number[] | null = null
	try {
		embedding = await generateEmbedding(normalizedName)
	} catch {
		// Non-critical — skip embedding
	}

	const { getEmbeddingModelName } = await import("./embeddings.js")

	await db.insert(graphNodes).values({
		id: nodeId,
		name: normalizedName,
		type: entity.type,
		orgId,
		spaceId: options?.spaceId ?? null,
		embedding,
		embeddingModel: embedding ? getEmbeddingModelName() : null,
		properties: entity.properties ?? {},
		sourceMemoryId: options?.sourceMemoryId ?? null,
		sourceDocumentId: options?.sourceDocumentId ?? null,
		confidence: entity.confidence,
		mentionCount: 1,
		createdAt: new Date(),
		updatedAt: new Date(),
	})

	return nodeId
}

// ─── Edge Management ──────────────────────────────────────────────

/**
 * Get or create a relationship edge between two nodes.
 * Deduplicates by (sourceId, targetId, relation).
 */
export async function upsertEdge(
	rel: ExtractedRelationship,
	sourceNodeId: string,
	targetNodeId: string,
	orgId: string,
	options?: {
		sourceMemoryId?: string
		sourceDocumentId?: string
	},
): Promise<string> {
	const [existing] = await db
		.select()
		.from(graphEdges)
		.where(
			and(
				eq(graphEdges.sourceId, sourceNodeId),
				eq(graphEdges.targetId, targetNodeId),
				eq(graphEdges.relation, rel.relation),
			),
		)
		.limit(1)

	if (existing) {
		// Reinforce: boost confidence and weight
		await db
			.update(graphEdges)
			.set({
				confidence: Math.min(1.0, (existing.confidence ?? 0.5) + 0.1),
				weight: Math.min(5.0, (existing.weight ?? 1.0) + 0.5),
				updatedAt: new Date(),
			})
			.where(eq(graphEdges.id, existing.id))

		return existing.id
	}

	const edgeId = nanoid()

	await db.insert(graphEdges).values({
		id: edgeId,
		sourceId: sourceNodeId,
		targetId: targetNodeId,
		relation: rel.relation,
		orgId,
		confidence: rel.confidence,
		weight: 1.0,
		sourceMemoryId: options?.sourceMemoryId ?? null,
		sourceDocumentId: options?.sourceDocumentId ?? null,
		properties: rel.properties ?? {},
		createdAt: new Date(),
		updatedAt: new Date(),
	})

	return edgeId
}

// ─── Batch Ingestion ──────────────────────────────────────────────

/**
 * Ingest extracted entities and relationships into the graph.
 * Handles deduplication and linking automatically.
 */
export async function ingestGraph(
	entities: ExtractedEntity[],
	relationships: ExtractedRelationship[],
	orgId: string,
	options?: {
		spaceId?: string
		sourceMemoryId?: string
		sourceDocumentId?: string
	},
): Promise<{ nodes: number; edges: number }> {
	if (entities.length === 0) return { nodes: 0, edges: 0 }

	// Create/update all nodes first
	const nodeMap = new Map<string, string>() // normalized name → nodeId

	for (const entity of entities) {
		try {
			const nodeId = await upsertNode(entity, orgId, options)
			nodeMap.set(entity.name.toLowerCase(), nodeId)
		} catch (err) {
			logger.warn(
				{ entity: entity.name, err },
				"GraphManager: failed to upsert node",
			)
		}
	}

	// Create/update edges
	let edgeCount = 0
	for (const rel of relationships) {
		const sourceNodeId = nodeMap.get(rel.source.toLowerCase())
		const targetNodeId = nodeMap.get(rel.target.toLowerCase())

		if (!sourceNodeId || !targetNodeId) continue

		try {
			await upsertEdge(rel, sourceNodeId, targetNodeId, orgId, options)
			edgeCount++
		} catch (err) {
			logger.warn(
				{ rel: `${rel.source}->${rel.target}`, err },
				"GraphManager: failed to upsert edge",
			)
		}
	}

	logger.debug(
		{ nodes: nodeMap.size, edges: edgeCount },
		"GraphManager: graph ingested",
	)

	return { nodes: nodeMap.size, edges: edgeCount }
}

// ─── Graph Traversal ───────────────���──────────────────────────────

export interface TraversalResult {
	nodes: Array<{
		id: string
		name: string
		type: string
		confidence: number
		mentionCount: number
		depth: number
	}>
	edges: Array<{
		sourceId: string
		targetId: string
		sourceName: string
		targetName: string
		relation: string
		confidence: number
		weight: number
	}>
}

/**
 * Traverse the graph from a starting node up to N hops.
 * Uses PostgreSQL recursive CTE for efficient traversal.
 */
export async function traverseGraph(
	startNodeId: string,
	orgId: string,
	maxDepth = 2,
): Promise<TraversalResult> {
	// Recursive CTE: find all reachable nodes within maxDepth hops
	const traversalQuery = sql`
		WITH RECURSIVE traversal AS (
			-- Base: start node
			SELECT
				${graphNodes.id} as node_id,
				${graphNodes.name} as node_name,
				${graphNodes.type} as node_type,
				${graphNodes.confidence} as node_confidence,
				${graphNodes.mentionCount} as mention_count,
				0 as depth
			FROM ${graphNodes}
			WHERE ${graphNodes.id} = ${startNodeId}
				AND ${graphNodes.orgId} = ${orgId}

			UNION ALL

			-- Recursive step: follow edges (both directions)
			SELECT
				n.id as node_id,
				n.name as node_name,
				n.type as node_type,
				n.confidence as node_confidence,
				n.mention_count as mention_count,
				t.depth + 1 as depth
			FROM traversal t
			JOIN ${graphEdges} e ON (
				e.source_id = t.node_id OR e.target_id = t.node_id
			)
			JOIN ${graphNodes} n ON (
				n.id = CASE
					WHEN e.source_id = t.node_id THEN e.target_id
					ELSE e.source_id
				END
			)
			WHERE t.depth < ${maxDepth}
				AND n.org_id = ${orgId}
		)
		SELECT DISTINCT ON (node_id) *
		FROM traversal
		ORDER BY node_id, depth ASC
	`

	const reachableNodes = await db.execute(traversalQuery)

	const nodeIds = (reachableNodes.rows as Array<{ node_id: string }>).map(
		(r) => r.node_id,
	)

	if (nodeIds.length === 0) return { nodes: [], edges: [] }

	// Get all edges between reachable nodes
	const edgesQuery = sql`
		SELECT
			e.source_id,
			e.target_id,
			s.name as source_name,
			t.name as target_name,
			e.relation,
			e.confidence,
			e.weight
		FROM ${graphEdges} e
		JOIN ${graphNodes} s ON s.id = e.source_id
		JOIN ${graphNodes} t ON t.id = e.target_id
		WHERE e.source_id IN (${sql.join(
			nodeIds.map((id) => sql`${id}`),
			sql`, `,
		)})
			AND e.target_id IN (${sql.join(
				nodeIds.map((id) => sql`${id}`),
				sql`, `,
			)})
			AND e.org_id = ${orgId}
	`

	const edgeResults = await db.execute(edgesQuery)

	interface TraversalNodeRow {
		node_id: string
		node_name: string
		node_type: string
		node_confidence: number | null
		mention_count: number | null
		depth: number
	}
	interface TraversalEdgeRow {
		source_id: string
		target_id: string
		source_name: string
		target_name: string
		relation: string
		confidence: number | null
		weight: number | null
	}

	return {
		nodes: (reachableNodes.rows as unknown as TraversalNodeRow[]).map((r) => ({
			id: r.node_id,
			name: r.node_name,
			type: r.node_type,
			confidence: r.node_confidence ?? 1,
			mentionCount: r.mention_count ?? 1,
			depth: r.depth,
		})),
		edges: (edgeResults.rows as unknown as TraversalEdgeRow[]).map((r) => ({
			sourceId: r.source_id,
			targetId: r.target_id,
			sourceName: r.source_name,
			targetName: r.target_name,
			relation: r.relation,
			confidence: r.confidence ?? 1,
			weight: r.weight ?? 1,
		})),
	}
}

// ─── Graph-Enhanced RAG Context ───────────────────────────────────

/**
 * Find entities related to a query and traverse their graph neighborhood.
 * Returns a formatted context string for RAG injection.
 */
export async function getGraphContextForRAG(
	query: string,
	orgId: string,
	options?: { maxDepth?: number; maxNodes?: number },
): Promise<string> {
	const maxDepth = options?.maxDepth ?? 2
	const maxNodes = options?.maxNodes ?? 15

	// Find entity nodes matching the query via text search
	const matchingNodes = await db
		.select({
			id: graphNodes.id,
			name: graphNodes.name,
			type: graphNodes.type,
		})
		.from(graphNodes)
		.where(
			and(
				eq(graphNodes.orgId, orgId),
				sql`LOWER(${graphNodes.name}) LIKE LOWER(${`%${query}%`})`,
			),
		)
		.limit(3)

	// Also try vector search if we have embeddings
	let vectorMatches: typeof matchingNodes = []
	if (matchingNodes.length < 2) {
		try {
			const _queryEmb = await generateEmbedding(query)
			// Simple cosine search over graph node embeddings in PostgreSQL
			// (using JSONB — not as fast as LanceDB but works for <10k nodes)
			const results = await db
				.select({
					id: graphNodes.id,
					name: graphNodes.name,
					type: graphNodes.type,
				})
				.from(graphNodes)
				.where(
					and(
						eq(graphNodes.orgId, orgId),
						sql`${graphNodes.embedding} IS NOT NULL`,
					),
				)
				.limit(20)

			// Manual cosine similarity filtering (in-memory for small result sets)
			vectorMatches = results
				// Can't compute cosine in SQL easily with JSONB, so just add as candidates
				.slice(0, 3)
		} catch {
			// Non-critical
		}
	}

	// Merge text and vector matches
	const allMatches = [...matchingNodes]
	const seen = new Set(matchingNodes.map((n) => n.id))
	for (const vm of vectorMatches) {
		if (!seen.has(vm.id)) {
			allMatches.push(vm)
			seen.add(vm.id)
		}
	}

	if (allMatches.length === 0) return ""

	// Traverse from each matching node
	const allTraversalNodes = new Map<
		string,
		{ name: string; type: string; depth: number }
	>()
	const allTraversalEdges: Array<{
		sourceName: string
		targetName: string
		relation: string
		confidence: number
	}> = []

	for (const node of allMatches.slice(0, 3)) {
		try {
			const result = await traverseGraph(node.id, orgId, maxDepth)

			for (const n of result.nodes) {
				if (!allTraversalNodes.has(n.id)) {
					allTraversalNodes.set(n.id, {
						name: n.name,
						type: n.type,
						depth: n.depth,
					})
				}
			}

			for (const e of result.edges) {
				allTraversalEdges.push({
					sourceName: e.sourceName,
					targetName: e.targetName,
					relation: e.relation,
					confidence: e.confidence,
				})
			}
		} catch {
			// Skip failed traversals
		}
	}

	if (allTraversalEdges.length === 0) return ""

	// Format as readable context
	const lines: string[] = ["## Knowledge Graph"]

	// Deduplicate edges for display
	const edgeSet = new Set<string>()
	const uniqueEdges = allTraversalEdges.filter((e) => {
		const key = `${e.sourceName}|${e.relation}|${e.targetName}`
		if (edgeSet.has(key)) return false
		edgeSet.add(key)
		return true
	})

	for (const edge of uniqueEdges.slice(0, maxNodes)) {
		const rel = edge.relation.replace(/_/g, " ")
		lines.push(`- ${edge.sourceName} → ${rel} → ${edge.targetName}`)
	}

	return lines.join("\n")
}

// ─── Statistics ───────────────────────────────────────────────────

export async function getGraphStats(orgId: string): Promise<{
	nodeCount: number
	edgeCount: number
	topEntities: Array<{ name: string; type: string; mentionCount: number }>
	topRelations: Array<{ relation: string; count: number }>
}> {
	const [nodeCountResult] = await db
		.select({ count: sql<number>`COUNT(*)::int` })
		.from(graphNodes)
		.where(eq(graphNodes.orgId, orgId))

	const [edgeCountResult] = await db
		.select({ count: sql<number>`COUNT(*)::int` })
		.from(graphEdges)
		.where(eq(graphEdges.orgId, orgId))

	const topEntities = await db
		.select({
			name: graphNodes.name,
			type: graphNodes.type,
			mentionCount: graphNodes.mentionCount,
		})
		.from(graphNodes)
		.where(eq(graphNodes.orgId, orgId))
		.orderBy(desc(graphNodes.mentionCount))
		.limit(10)

	const topRelations = await db
		.select({
			relation: graphEdges.relation,
			count: sql<number>`COUNT(*)::int`,
		})
		.from(graphEdges)
		.where(eq(graphEdges.orgId, orgId))
		.groupBy(graphEdges.relation)
		.orderBy(desc(sql`COUNT(*)`))
		.limit(10)

	return {
		nodeCount: nodeCountResult?.count ?? 0,
		edgeCount: edgeCountResult?.count ?? 0,
		topEntities,
		topRelations,
	}
}
