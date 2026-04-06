/**
 * Memory routes — CRUD + maintenance for advanced memory management.
 *
 * GET    /                — List memories (with filtering)
 * GET    /:id             — Get single memory with version history
 * PATCH  /:id             — Update memory content (creates new version)
 * DELETE /:id             — Soft-delete (mark as forgotten)
 * POST   /:id/reinforce   — Manually reinforce a memory
 * POST   /:id/pin         — Pin memory as static (no decay)
 * POST   /maintenance      — Trigger memory maintenance (decay + expire)
 * GET    /stats            — Memory statistics
 */

import { Hono } from "hono"
import { eq, and, desc, sql, count } from "drizzle-orm"
import { db } from "../db/index.js"
import { memoryEntries, memoryDocumentSources } from "../db/schema.js"
import { getSession } from "../middleware/auth.js"
import {
	updateMemoryWithVersion,
	reinforceMemory,
	runMemoryMaintenance,
} from "../processing/memory-manager.js"
import { MemoryLevel } from "../processing/memory-types.js"
import { logger } from "../logger.js"

export const memoriesRoutes = new Hono()

// ─── GET / — List memories ────────────────────────────────────────

memoriesRoutes.get("/", async (c) => {
	const session = getSession(c)
	const level = c.req.query("level") // filter by memoryLevel
	const forgotten = c.req.query("forgotten") === "true"
	const agentId = c.req.query("agentId")
	const sessionId = c.req.query("sessionId")
	const limit = Math.min(Number(c.req.query("limit") || 50), 200)
	const offset = Number(c.req.query("offset") || 0)

	const conditions = [
		eq(memoryEntries.orgId, session.orgId),
		eq(memoryEntries.isLatest, true),
		eq(memoryEntries.isForgotten, forgotten),
	]

	if (level && Object.values(MemoryLevel).includes(level as MemoryLevel)) {
		conditions.push(eq(memoryEntries.memoryLevel, level))
	}

	if (agentId) {
		conditions.push(eq(memoryEntries.agentId, agentId))
	}

	if (sessionId) {
		conditions.push(eq(memoryEntries.sessionId, sessionId))
	}

	const memories = await db
		.select({
			id: memoryEntries.id,
			memory: memoryEntries.memory,
			confidence: memoryEntries.confidence,
			memoryLevel: memoryEntries.memoryLevel,
			sourceCount: memoryEntries.sourceCount,
			isStatic: memoryEntries.isStatic,
			isForgotten: memoryEntries.isForgotten,
			version: memoryEntries.version,
			createdAt: memoryEntries.createdAt,
			updatedAt: memoryEntries.updatedAt,
		})
		.from(memoryEntries)
		.where(and(...conditions))
		.orderBy(desc(memoryEntries.confidence), desc(memoryEntries.updatedAt))
		.limit(limit)
		.offset(offset)

	return c.json({
		memories: memories.map((m) => ({
			...m,
			createdAt: m.createdAt.toISOString(),
			updatedAt: m.updatedAt.toISOString(),
		})),
		pagination: { limit, offset },
	})
})

// ─── GET /stats — Memory statistics ───────────────────────────────

memoriesRoutes.get("/stats", async (c) => {
	const session = getSession(c)

	const [stats] = await db
		.select({
			total: count(),
			avgConfidence: sql<number>`AVG(${memoryEntries.confidence})`,
		})
		.from(memoryEntries)
		.where(
			and(
				eq(memoryEntries.orgId, session.orgId),
				eq(memoryEntries.isLatest, true),
				eq(memoryEntries.isForgotten, false),
			),
		)

	// Count by level
	const levelCounts = await db
		.select({
			level: memoryEntries.memoryLevel,
			count: count(),
		})
		.from(memoryEntries)
		.where(
			and(
				eq(memoryEntries.orgId, session.orgId),
				eq(memoryEntries.isLatest, true),
				eq(memoryEntries.isForgotten, false),
			),
		)
		.groupBy(memoryEntries.memoryLevel)

	const forgottenCount = await db
		.select({ count: count() })
		.from(memoryEntries)
		.where(
			and(
				eq(memoryEntries.orgId, session.orgId),
				eq(memoryEntries.isForgotten, true),
			),
		)

	return c.json({
		total: stats?.total ?? 0,
		avgConfidence: stats?.avgConfidence
			? Number(stats.avgConfidence.toFixed(3))
			: 0,
		forgotten: forgottenCount[0]?.count ?? 0,
		byLevel: Object.fromEntries(
			levelCounts.map((lc) => [lc.level ?? "unknown", lc.count]),
		),
	})
})

// ─── GET /:id — Get memory with version history ───────────────────

memoriesRoutes.get("/:id", async (c) => {
	const session = getSession(c)
	const memoryId = c.req.param("id")

	const [memory] = await db
		.select()
		.from(memoryEntries)
		.where(
			and(
				eq(memoryEntries.id, memoryId),
				eq(memoryEntries.orgId, session.orgId),
			),
		)
		.limit(1)

	if (!memory) return c.json({ error: "Memory not found" }, 404)

	// Get version history if this has versions
	const rootId = memory.rootMemoryId ?? memoryId
	const versions = await db
		.select({
			id: memoryEntries.id,
			memory: memoryEntries.memory,
			version: memoryEntries.version,
			confidence: memoryEntries.confidence,
			isLatest: memoryEntries.isLatest,
			createdAt: memoryEntries.createdAt,
		})
		.from(memoryEntries)
		.where(
			and(
				eq(memoryEntries.orgId, session.orgId),
				sql`(${memoryEntries.id} = ${rootId} OR ${memoryEntries.rootMemoryId} = ${rootId})`,
			),
		)
		.orderBy(desc(memoryEntries.version))

	// Get linked documents
	const sources = await db
		.select({
			documentId: memoryDocumentSources.documentId,
			relevanceScore: memoryDocumentSources.relevanceScore,
			addedAt: memoryDocumentSources.addedAt,
		})
		.from(memoryDocumentSources)
		.where(eq(memoryDocumentSources.memoryEntryId, memoryId))

	return c.json({
		memory: {
			...memory,
			createdAt: memory.createdAt.toISOString(),
			updatedAt: memory.updatedAt.toISOString(),
		},
		versions: versions.map((v) => ({
			...v,
			createdAt: v.createdAt.toISOString(),
		})),
		sources: sources.map((s) => ({
			...s,
			addedAt: s.addedAt?.toISOString(),
		})),
	})
})

// ─── PATCH /:id — Update memory (versioned) ──────────────────────

memoriesRoutes.patch("/:id", async (c) => {
	const session = getSession(c)
	const memoryId = c.req.param("id")
	const body = await c.req.json()

	// Verify ownership
	const [existing] = await db
		.select()
		.from(memoryEntries)
		.where(
			and(
				eq(memoryEntries.id, memoryId),
				eq(memoryEntries.orgId, session.orgId),
			),
		)
		.limit(1)

	if (!existing) return c.json({ error: "Memory not found" }, 404)

	if (body.memory && body.memory !== existing.memory) {
		// Content changed — create new version
		const newId = await updateMemoryWithVersion(
			memoryId,
			body.memory,
			body.reason || "manual_edit",
		)

		if (!newId) return c.json({ error: "Failed to update memory" }, 500)

		return c.json({
			id: newId,
			message: "Memory updated (new version created)",
		})
	}

	// Metadata-only update (no versioning needed)
	const updates: Record<string, unknown> = { updatedAt: new Date() }
	if (body.isStatic !== undefined) updates.isStatic = body.isStatic
	if (
		body.memoryLevel &&
		Object.values(MemoryLevel).includes(body.memoryLevel)
	) {
		updates.memoryLevel = body.memoryLevel
	}
	if (typeof body.confidence === "number") {
		updates.confidence = Math.min(1, Math.max(0, body.confidence))
	}

	await db
		.update(memoryEntries)
		.set(updates)
		.where(eq(memoryEntries.id, memoryId))

	return c.json({ id: memoryId, message: "Memory metadata updated" })
})

// ─── DELETE /:id — Soft-delete (forget) ───────────────────────────

memoriesRoutes.delete("/:id", async (c) => {
	const session = getSession(c)
	const memoryId = c.req.param("id")

	const updated = await db
		.update(memoryEntries)
		.set({
			isForgotten: true,
			forgetReason: "manual",
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(memoryEntries.id, memoryId),
				eq(memoryEntries.orgId, session.orgId),
			),
		)
		.returning({ id: memoryEntries.id })

	if (updated.length === 0) return c.json({ error: "Memory not found" }, 404)

	return c.json({ success: true, message: "Memory forgotten" })
})

// ─── POST /:id/reinforce — Manual reinforcement ──────────────────

memoriesRoutes.post("/:id/reinforce", async (c) => {
	const session = getSession(c)
	const memoryId = c.req.param("id")

	// Verify ownership
	const [existing] = await db
		.select()
		.from(memoryEntries)
		.where(
			and(
				eq(memoryEntries.id, memoryId),
				eq(memoryEntries.orgId, session.orgId),
			),
		)
		.limit(1)

	if (!existing) return c.json({ error: "Memory not found" }, 404)

	// Reinforce with high confidence (manual = strong signal)
	await reinforceMemory(memoryId, 0.9, "manual")

	// Re-fetch to get updated values
	const [updated] = await db
		.select({
			confidence: memoryEntries.confidence,
			memoryLevel: memoryEntries.memoryLevel,
		})
		.from(memoryEntries)
		.where(eq(memoryEntries.id, memoryId))
		.limit(1)

	return c.json({
		success: true,
		confidence: updated?.confidence,
		memoryLevel: updated?.memoryLevel,
	})
})

// ─── POST /:id/pin — Pin as static (no decay) ────────────────────

memoriesRoutes.post("/:id/pin", async (c) => {
	const session = getSession(c)
	const memoryId = c.req.param("id")

	const body = await c.req.json().catch(() => ({}))
	const pin = body.pin !== false // default: true

	const updated = await db
		.update(memoryEntries)
		.set({ isStatic: pin, updatedAt: new Date() })
		.where(
			and(
				eq(memoryEntries.id, memoryId),
				eq(memoryEntries.orgId, session.orgId),
			),
		)
		.returning({ id: memoryEntries.id })

	if (updated.length === 0) return c.json({ error: "Memory not found" }, 404)

	return c.json({ success: true, isStatic: pin })
})

// ─── POST /maintenance — Trigger maintenance ─────────────────────

memoriesRoutes.post("/maintenance", async (c) => {
	const session = getSession(c)
	logger.info({ orgId: session.orgId }, "Manual memory maintenance triggered")

	const result = await runMemoryMaintenance()

	return c.json({
		message: "Maintenance complete",
		...result,
	})
})
