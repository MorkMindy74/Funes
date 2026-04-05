/**
 * Import/Export routes — Backup and restore user data.
 *
 * GET  /export        — Export all user data as JSON (documents, memories, threads)
 * POST /import        — Import previously exported data
 * GET  /export/status — Check if export is available
 */

import { Hono } from "hono"
import { eq, and, inArray } from "drizzle-orm"
import { db } from "../db/index.js"
import {
	documents,
	chunks,
	memoryEntries,
	memoryDocumentSources,
	spaces,
	documentsToSpaces,
	chatThreads,
	chatMessages,
} from "../db/schema.js"
import { getSession } from "../middleware/auth.js"
import { logger } from "../logger.js"
import { nanoid } from "nanoid"

export const importExportRoutes = new Hono()

// ─── Export format version ─────────────────────────────────────────

const EXPORT_VERSION = "1.0.0"

interface FunesExport {
	version: string
	exportedAt: string
	orgId: string
	data: {
		documents: Array<{
			id: string
			title: string | null
			content: string | null
			type: string
			status: string
			containerTags: string[] | null
			metadata: Record<string, unknown> | null
			tokenCount: number | null
			wordCount: number | null
			createdAt: string
			updatedAt: string
		}>
		memories: Array<{
			id: string
			memory: string
			spaceId: string
			isStatic: boolean | null
			isForgotten: boolean | null
			confidence: number | null
			memoryLevel: string | null
			version: number | null
			createdAt: string
			updatedAt: string
		}>
		spaces: Array<{
			id: string
			name: string | null
			containerTag: string | null
			visibility: string | null
			emoji: string | null
			createdAt: string
			updatedAt: string
		}>
		chatThreads: Array<{
			id: string
			title: string | null
			metadata: Record<string, unknown> | null
			createdAt: string
			updatedAt: string
			messages: Array<{
				id: string
				role: string
				content: string
				createdAt: string
			}>
		}>
	}
}

// ─── GET /export — Full data export ────────────────────────────────

importExportRoutes.get("/export", async (c) => {
	const session = getSession(c)
	const orgId = session.orgId

	logger.info({ orgId }, "Starting data export")

	try {
		// Fetch all data in parallel
		const [docs, mems, spcs, threads] = await Promise.all([
			db.select().from(documents).where(eq(documents.orgId, orgId)),
			db.select().from(memoryEntries),
			db.select().from(spaces).where(eq(spaces.orgId, orgId)),
			db.select().from(chatThreads).where(eq(chatThreads.orgId, orgId)),
		])

		// Filter memories by spaces belonging to this org
		const orgSpaceIds = new Set(spcs.map((s) => s.id))
		const orgMemories = mems.filter((m) => orgSpaceIds.has(m.spaceId))

		// Fetch chat messages for all threads
		const threadIds = threads.map((t) => t.id)
		const messages =
			threadIds.length > 0
				? await db
						.select()
						.from(chatMessages)
						.where(inArray(chatMessages.threadId, threadIds))
				: []

		// Group messages by thread
		const messagesByThread = new Map<string, typeof messages>()
		for (const msg of messages) {
			const list = messagesByThread.get(msg.threadId) ?? []
			list.push(msg)
			messagesByThread.set(msg.threadId, list)
		}

		const exportData: FunesExport = {
			version: EXPORT_VERSION,
			exportedAt: new Date().toISOString(),
			orgId,
			data: {
				documents: docs.map((d) => ({
					id: d.id,
					title: d.title,
					content: d.content,
					type: d.type,
					status: d.status,
					containerTags: d.containerTags,
					metadata: d.metadata,
					tokenCount: d.tokenCount,
					wordCount: d.wordCount,
					createdAt: d.createdAt.toISOString(),
					updatedAt: d.updatedAt.toISOString(),
				})),
				memories: orgMemories.map((m) => ({
					id: m.id,
					memory: m.memory,
					spaceId: m.spaceId,
					isStatic: m.isStatic,
					isForgotten: m.isForgotten,
					confidence: m.confidence,
					memoryLevel: m.memoryLevel,
					version: m.version,
					createdAt: m.createdAt.toISOString(),
					updatedAt: m.updatedAt.toISOString(),
				})),
				spaces: spcs.map((s) => ({
					id: s.id,
					name: s.name,
					containerTag: s.containerTag,
					visibility: s.visibility,
					emoji: s.emoji,
					createdAt: s.createdAt.toISOString(),
					updatedAt: s.updatedAt.toISOString(),
				})),
				chatThreads: threads.map((t) => ({
					id: t.id,
					title: t.title,
					metadata: t.metadata,
					createdAt: t.createdAt.toISOString(),
					updatedAt: t.updatedAt.toISOString(),
					messages: (messagesByThread.get(t.id) ?? [])
						.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
						.map((m) => ({
							id: m.id,
							role: m.role,
							content: m.content,
							createdAt: m.createdAt.toISOString(),
						})),
				})),
			},
		}

		logger.info(
			{
				orgId,
				documents: docs.length,
				memories: orgMemories.length,
				spaces: spcs.length,
				threads: threads.length,
			},
			"Export completed",
		)

		// Return as downloadable JSON
		c.header("Content-Type", "application/json")
		c.header(
			"Content-Disposition",
			`attachment; filename="funes-export-${new Date().toISOString().slice(0, 10)}.json"`,
		)
		return c.json(exportData)
	} catch (error) {
		logger.error({ error }, "Export failed")
		return c.json({ error: "Export failed" }, 500)
	}
})

// ─── POST /import — Restore from export ────────────────────────────

importExportRoutes.post("/import", async (c) => {
	const session = getSession(c)
	const orgId = session.orgId

	const body = (await c.req.json()) as FunesExport

	if (!body.version || !body.data) {
		return c.json({ error: "Invalid export format" }, 400)
	}

	logger.info(
		{
			orgId,
			exportVersion: body.version,
			documents: body.data.documents?.length ?? 0,
			memories: body.data.memories?.length ?? 0,
		},
		"Starting data import",
	)

	const stats = { documents: 0, memories: 0, spaces: 0, threads: 0, skipped: 0 }

	try {
		// Import spaces first (memories reference them)
		if (body.data.spaces?.length) {
			for (const space of body.data.spaces) {
				try {
					await db
						.insert(spaces)
						.values({
							id: space.id,
							name: space.name,
							containerTag: space.containerTag,
							orgId,
							visibility: space.visibility ?? "private",
							emoji: space.emoji,
							createdAt: new Date(space.createdAt),
							updatedAt: new Date(space.updatedAt),
						})
						.onConflictDoNothing()
					stats.spaces++
				} catch {
					stats.skipped++
				}
			}
		}

		// Import documents
		if (body.data.documents?.length) {
			for (const doc of body.data.documents) {
				try {
					await db
						.insert(documents)
						.values({
							id: doc.id,
							title: doc.title,
							content: doc.content,
							type: doc.type,
							status: doc.status,
							orgId,
							containerTags: doc.containerTags,
							metadata: doc.metadata,
							tokenCount: doc.tokenCount,
							wordCount: doc.wordCount,
							createdAt: new Date(doc.createdAt),
							updatedAt: new Date(doc.updatedAt),
						})
						.onConflictDoNothing()
					stats.documents++
				} catch {
					stats.skipped++
				}
			}
		}

		// Import memories
		if (body.data.memories?.length) {
			for (const mem of body.data.memories) {
				try {
					await db
						.insert(memoryEntries)
						.values({
							id: mem.id,
							memory: mem.memory,
							spaceId: mem.spaceId,
							isStatic: mem.isStatic,
							isForgotten: mem.isForgotten,
							confidence: mem.confidence,
							memoryLevel: mem.memoryLevel,
							version: mem.version,
							isLatest: true,
							createdAt: new Date(mem.createdAt),
							updatedAt: new Date(mem.updatedAt),
						})
						.onConflictDoNothing()
					stats.memories++
				} catch {
					stats.skipped++
				}
			}
		}

		// Import chat threads + messages
		if (body.data.chatThreads?.length) {
			for (const thread of body.data.chatThreads) {
				try {
					await db
						.insert(chatThreads)
						.values({
							id: thread.id,
							orgId,
							userId: session.user.id,
							title: thread.title,
							metadata: thread.metadata,
							createdAt: new Date(thread.createdAt),
							updatedAt: new Date(thread.updatedAt),
						})
						.onConflictDoNothing()

					if (thread.messages?.length) {
						for (const msg of thread.messages) {
							await db
								.insert(chatMessages)
								.values({
									id: msg.id,
									threadId: thread.id,
									role: msg.role,
									content: msg.content,
									createdAt: new Date(msg.createdAt),
								})
								.onConflictDoNothing()
						}
					}
					stats.threads++
				} catch {
					stats.skipped++
				}
			}
		}

		logger.info({ orgId, stats }, "Import completed")

		return c.json({
			success: true,
			imported: stats,
			message: `Imported ${stats.documents} documents, ${stats.memories} memories, ${stats.spaces} spaces, ${stats.threads} chat threads. ${stats.skipped} items skipped (duplicates).`,
		})
	} catch (error) {
		logger.error({ error }, "Import failed")
		return c.json({ error: "Import failed" }, 500)
	}
})

// ─── GET /export/status — Quick check ──────────────────────────────

importExportRoutes.get("/export/status", async (c) => {
	const session = getSession(c)

	const [docCount] = await db
		.select({ count: documents.id })
		.from(documents)
		.where(eq(documents.orgId, session.orgId))
		.limit(1)

	return c.json({
		available: true,
		version: EXPORT_VERSION,
		estimatedItems: docCount ? 1 : 0, // Rough indicator
	})
})
