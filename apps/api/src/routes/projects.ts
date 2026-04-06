import { Hono } from "hono"
import { nanoid } from "nanoid"
import { and, eq, inArray, count } from "drizzle-orm"
import { db } from "../db/index.js"
import {
	spaces,
	documents,
	documentsToSpaces,
	memoryEntries,
} from "../db/schema.js"
import { getSession } from "../middleware/auth.js"

export const projectsRoutes = new Hono()

// GET / — List projects (spaces with sm_project_ prefix)
projectsRoutes.get("/", async (c) => {
	const session = getSession(c)

	const allSpaces = await db
		.select()
		.from(spaces)
		.where(eq(spaces.orgId, session.orgId))

	// Count documents per space
	const docCounts = await db
		.select({
			spaceId: documentsToSpaces.spaceId,
			count: count(),
		})
		.from(documentsToSpaces)
		.where(
			inArray(
				documentsToSpaces.spaceId,
				allSpaces.map((s) => s.id),
			),
		)
		.groupBy(documentsToSpaces.spaceId)

	const countMap = new Map(docCounts.map((r) => [r.spaceId, r.count]))

	return c.json({
		projects: allSpaces
			.filter((s) => s.containerTag?.startsWith("sm_project_"))
			.map((s) => ({
				id: s.id,
				name: s.name ?? "",
				containerTag: s.containerTag ?? "",
				createdAt: s.createdAt.toISOString(),
				updatedAt: s.updatedAt.toISOString(),
				isExperimental: s.isExperimental,
				documentCount: countMap.get(s.id) ?? 0,
				emoji: s.emoji,
			})),
	})
})

// POST / — Create a project
projectsRoutes.post("/", async (c) => {
	const session = getSession(c)
	const body = await c.req.json()

	const { name, emoji } = body
	if (!name) return c.json({ error: "Name is required" }, 400)

	const containerTag = `sm_project_${name.toLowerCase().replace(/\s+/g, "_")}`
	const id = nanoid()
	const now = new Date()

	// Check for duplicate
	const existing = await db
		.select()
		.from(spaces)
		.where(
			and(
				eq(spaces.containerTag, containerTag),
				eq(spaces.orgId, session.orgId),
			),
		)
		.limit(1)

	if (existing.length > 0) {
		return c.json({ error: "Project with this name already exists" }, 409)
	}

	const [space] = await db
		.insert(spaces)
		.values({
			id,
			name,
			orgId: session.orgId,
			ownerId: session.user.id,
			containerTag,
			emoji: emoji ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.returning()

	return c.json(
		{
			id: space.id,
			name: space.name ?? "",
			containerTag: space.containerTag ?? "",
			createdAt: space.createdAt.toISOString(),
			updatedAt: space.updatedAt.toISOString(),
			isExperimental: space.isExperimental,
			documentCount: 0,
			emoji: space.emoji,
		},
		201,
	)
})

// DELETE /:projectId — Delete a project
projectsRoutes.delete("/:projectId", async (c) => {
	const session = getSession(c)
	const projectId = c.req.param("projectId")
	const body = await c.req.json().catch(() => ({ action: "delete" }))

	const { action = "delete", targetProjectId } = body

	// Find the space
	const [space] = await db
		.select()
		.from(spaces)
		.where(and(eq(spaces.id, projectId), eq(spaces.orgId, session.orgId)))
		.limit(1)

	if (!space) return c.json({ error: "Project not found" }, 404)

	// Get all documents in this space
	const docLinks = await db
		.select({ documentId: documentsToSpaces.documentId })
		.from(documentsToSpaces)
		.where(eq(documentsToSpaces.spaceId, projectId))

	const docsAffected = docLinks.length
	let memoriesAffected = 0

	if (action === "move" && targetProjectId) {
		// Move documents to target project
		for (const link of docLinks) {
			await db
				.insert(documentsToSpaces)
				.values({ documentId: link.documentId, spaceId: targetProjectId })
				.onConflictDoNothing()
		}
	} else {
		// Delete documents
		if (docLinks.length > 0) {
			await db.delete(documents).where(
				inArray(
					documents.id,
					docLinks.map((d) => d.documentId),
				),
			)
		}
	}

	// Count and delete memories in this space
	const [memCount] = await db
		.select({ count: count() })
		.from(memoryEntries)
		.where(eq(memoryEntries.spaceId, projectId))

	memoriesAffected = memCount?.count ?? 0

	// Delete the space (cascades to memories and links)
	await db.delete(spaces).where(eq(spaces.id, projectId))

	return c.json({
		success: true,
		message: "Project deleted successfully",
		documentsAffected: docsAffected,
		memoriesAffected,
	})
})
