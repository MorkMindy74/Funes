/**
 * Knowledge Graph routes — entity and relationship management.
 *
 * GET    /nodes           — List entity nodes (with filtering)
 * GET    /nodes/:id       — Get node with edges
 * GET    /traverse/:id    — Traverse graph from a node
 * GET    /search          — Search entities by name
 * GET    /stats           — Graph statistics
 * GET    /visualize       — Graph data in D3-compatible format
 */

import { Hono } from "hono"
import { eq, and, sql, desc } from "drizzle-orm"
import { db } from "../db/index.js"
import { graphNodes, graphEdges } from "../db/schema.js"
import { getSession } from "../middleware/auth.js"
import { traverseGraph, getGraphStats } from "../processing/graph-manager.js"

export const graphRoutes = new Hono()

// ─── GET /nodes — List nodes ──────────────────────────────────────

graphRoutes.get("/nodes", async (c) => {
	const session = getSession(c)
	const type = c.req.query("type")
	const limit = Math.min(Number(c.req.query("limit") || 50), 200)
	const offset = Number(c.req.query("offset") || 0)

	const conditions = [eq(graphNodes.orgId, session.orgId)]
	if (type) conditions.push(eq(graphNodes.type, type))

	const nodes = await db
		.select({
			id: graphNodes.id,
			name: graphNodes.name,
			type: graphNodes.type,
			confidence: graphNodes.confidence,
			mentionCount: graphNodes.mentionCount,
			properties: graphNodes.properties,
			createdAt: graphNodes.createdAt,
			updatedAt: graphNodes.updatedAt,
		})
		.from(graphNodes)
		.where(and(...conditions))
		.orderBy(desc(graphNodes.mentionCount))
		.limit(limit)
		.offset(offset)

	return c.json({
		nodes: nodes.map((n) => ({
			...n,
			createdAt: n.createdAt.toISOString(),
			updatedAt: n.updatedAt.toISOString(),
		})),
	})
})

// ─── GET /nodes/:id — Get node with edges ────────────────────────

graphRoutes.get("/nodes/:id", async (c) => {
	const session = getSession(c)
	const nodeId = c.req.param("id")

	const [node] = await db
		.select()
		.from(graphNodes)
		.where(and(eq(graphNodes.id, nodeId), eq(graphNodes.orgId, session.orgId)))
		.limit(1)

	if (!node) return c.json({ error: "Node not found" }, 404)

	// Get outgoing edges
	const outgoing = await db
		.select({
			id: graphEdges.id,
			targetId: graphEdges.targetId,
			relation: graphEdges.relation,
			confidence: graphEdges.confidence,
			weight: graphEdges.weight,
			targetName: graphNodes.name,
			targetType: graphNodes.type,
		})
		.from(graphEdges)
		.innerJoin(graphNodes, eq(graphNodes.id, graphEdges.targetId))
		.where(eq(graphEdges.sourceId, nodeId))

	// Get incoming edges
	const incoming = await db
		.select({
			id: graphEdges.id,
			sourceId: graphEdges.sourceId,
			relation: graphEdges.relation,
			confidence: graphEdges.confidence,
			weight: graphEdges.weight,
			sourceName: graphNodes.name,
			sourceType: graphNodes.type,
		})
		.from(graphEdges)
		.innerJoin(graphNodes, eq(graphNodes.id, graphEdges.sourceId))
		.where(eq(graphEdges.targetId, nodeId))

	return c.json({
		node: {
			...node,
			createdAt: node.createdAt.toISOString(),
			updatedAt: node.updatedAt.toISOString(),
		},
		outgoing,
		incoming,
	})
})

// ─── GET /traverse/:id — Graph traversal ─────────────────────────

graphRoutes.get("/traverse/:id", async (c) => {
	const session = getSession(c)
	const nodeId = c.req.param("id")
	const depth = Math.min(Number(c.req.query("depth") || 2), 4)

	const result = await traverseGraph(nodeId, session.orgId, depth)

	return c.json(result)
})

// ─���─ GET /search — Search entities ───────────────────────────────

graphRoutes.get("/search", async (c) => {
	const session = getSession(c)
	const q = c.req.query("q")

	if (!q || q.trim().length < 2) {
		return c.json({ error: "Query must be at least 2 characters" }, 400)
	}

	const results = await db
		.select({
			id: graphNodes.id,
			name: graphNodes.name,
			type: graphNodes.type,
			confidence: graphNodes.confidence,
			mentionCount: graphNodes.mentionCount,
		})
		.from(graphNodes)
		.where(
			and(
				eq(graphNodes.orgId, session.orgId),
				sql`LOWER(${graphNodes.name}) LIKE LOWER(${`%${q.trim()}%`})`,
			),
		)
		.orderBy(desc(graphNodes.mentionCount))
		.limit(20)

	return c.json({ results })
})

// ─── GET /stats — Graph statistics ───────────────────────────────

graphRoutes.get("/stats", async (c) => {
	const session = getSession(c)
	const stats = await getGraphStats(session.orgId)
	return c.json(stats)
})

// ─── GET /visualize — D3-compatible format ───────────────────────

graphRoutes.get("/visualize", async (c) => {
	const session = getSession(c)
	const limit = Math.min(Number(c.req.query("limit") || 100), 500)

	// Get top nodes by mention count
	const nodes = await db
		.select({
			id: graphNodes.id,
			name: graphNodes.name,
			type: graphNodes.type,
			mentionCount: graphNodes.mentionCount,
			confidence: graphNodes.confidence,
		})
		.from(graphNodes)
		.where(eq(graphNodes.orgId, session.orgId))
		.orderBy(desc(graphNodes.mentionCount))
		.limit(limit)

	const nodeIds = nodes.map((n) => n.id)

	if (nodeIds.length === 0) {
		return c.json({ nodes: [], links: [] })
	}

	// Get edges between these nodes
	const edges = await db
		.select({
			source: graphEdges.sourceId,
			target: graphEdges.targetId,
			relation: graphEdges.relation,
			weight: graphEdges.weight,
			confidence: graphEdges.confidence,
		})
		.from(graphEdges)
		.where(
			and(
				eq(graphEdges.orgId, session.orgId),
				sql`${graphEdges.sourceId} IN (${sql.join(
					nodeIds.map((id) => sql`${id}`),
					sql`, `,
				)})`,
				sql`${graphEdges.targetId} IN (${sql.join(
					nodeIds.map((id) => sql`${id}`),
					sql`, `,
				)})`,
			),
		)

	// D3 force-directed graph format
	return c.json({
		nodes: nodes.map((n) => ({
			id: n.id,
			label: n.name,
			group: n.type,
			size: Math.min(30, 5 + (n.mentionCount ?? 1) * 2),
		})),
		links: edges.map((e) => ({
			source: e.source,
			target: e.target,
			label: e.relation?.replace(/_/g, " "),
			value: e.weight ?? 1,
		})),
	})
})
