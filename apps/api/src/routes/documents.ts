import { Hono } from "hono"
import { nanoid } from "nanoid"
import { and, eq, inArray, desc, asc, sql, count } from "drizzle-orm"
import { db } from "../db/index.js"
import {
	documents,
	chunks,
	documentsToSpaces,
	spaces,
	memoryEntries,
	memoryDocumentSources,
} from "../db/schema.js"
import { getSession } from "../middleware/auth.js"
import { logger } from "../logger.js"

export const documentsRoutes = new Hono()

// POST /documents — Add a new document/memory
documentsRoutes.post("/", async (c) => {
	const session = getSession(c)
	const body = await c.req.json()

	const id = nanoid()
	const now = new Date()

	// Create the document
	const [doc] = await db
		.insert(documents)
		.values({
			id,
			orgId: session.orgId,
			userId: session.user.id,
			content: body.content ?? null,
			customId: body.customId ?? null,
			title: null,
			type: "text",
			status: "queued",
			metadata: body.metadata ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.returning({ id: documents.id, status: documents.status })

	// Associate with spaces via containerTags
	if (body.containerTags?.length) {
		for (const tag of body.containerTags) {
			// Find or create space for this tag
			let space = await db
				.select()
				.from(spaces)
				.where(and(eq(spaces.containerTag, tag), eq(spaces.orgId, session.orgId)))
				.limit(1)
				.then((r) => r[0])

			if (!space) {
				const spaceId = nanoid()
				const spaceName = tag.startsWith("sm_project_")
					? tag.replace("sm_project_", "").replace(/_/g, " ")
					: tag
				;[space] = await db
					.insert(spaces)
					.values({
						id: spaceId,
						name: spaceName,
						orgId: session.orgId,
						ownerId: session.user.id,
						containerTag: tag,
						createdAt: now,
						updatedAt: now,
					})
					.returning()
			}

			await db
				.insert(documentsToSpaces)
				.values({ documentId: id, spaceId: space.id })
				.onConflictDoNothing()
		}
	}

	// TODO (M2): Enqueue processing pipeline
	// await extractQueue.add("extract", { documentId: id })

	logger.info({ documentId: id }, "Document created, queued for processing")

	return c.json({ id: doc.id, status: doc.status }, 201)
})

// POST /documents/list — List documents with pagination
documentsRoutes.post("/list", async (c) => {
	const session = getSession(c)
	const body = (await c.req.json().catch(() => ({}))) as {
		page?: number
		limit?: number
		status?: string
		containerTags?: string[]
	}

	const page = body.page ?? 1
	const limit = Math.min(body.limit ?? 10, 1100)
	const offset = (page - 1) * limit

	const conditions = [eq(documents.orgId, session.orgId)]

	if (body.status) {
		conditions.push(eq(documents.status, body.status))
	}

	// Filter by containerTags via join
	let query
	if (body.containerTags?.length) {
		const spaceRows = await db
			.select({ id: spaces.id })
			.from(spaces)
			.where(
				and(
					eq(spaces.orgId, session.orgId),
					inArray(spaces.containerTag, body.containerTags),
				),
			)
		const spaceIds = spaceRows.map((s) => s.id)

		if (spaceIds.length === 0) {
			return c.json({
				memories: [],
				pagination: { currentPage: page, limit, totalItems: 0, totalPages: 0 },
			})
		}

		const docIds = await db
			.selectDistinct({ documentId: documentsToSpaces.documentId })
			.from(documentsToSpaces)
			.where(inArray(documentsToSpaces.spaceId, spaceIds))

		if (docIds.length === 0) {
			return c.json({
				memories: [],
				pagination: { currentPage: page, limit, totalItems: 0, totalPages: 0 },
			})
		}

		conditions.push(
			inArray(
				documents.id,
				docIds.map((d) => d.documentId),
			),
		)
	}

	const whereClause = and(...conditions)

	const [totalResult] = await db
		.select({ count: count() })
		.from(documents)
		.where(whereClause)

	const totalItems = totalResult?.count ?? 0

	const docs = await db
		.select({
			id: documents.id,
			customId: documents.customId,
			connectionId: documents.connectionId,
			title: documents.title,
			summary: documents.summary,
			type: documents.type,
			status: documents.status,
			metadata: documents.metadata,
			createdAt: documents.createdAt,
			updatedAt: documents.updatedAt,
		})
		.from(documents)
		.where(whereClause)
		.orderBy(desc(documents.createdAt))
		.limit(limit)
		.offset(offset)

	// Get containerTags for each doc
	const docIds = docs.map((d) => d.id)
	const tagRows =
		docIds.length > 0
			? await db
					.select({
						documentId: documentsToSpaces.documentId,
						containerTag: spaces.containerTag,
					})
					.from(documentsToSpaces)
					.innerJoin(spaces, eq(documentsToSpaces.spaceId, spaces.id))
					.where(inArray(documentsToSpaces.documentId, docIds))
			: []

	const tagsByDoc = new Map<string, string[]>()
	for (const row of tagRows) {
		const tags = tagsByDoc.get(row.documentId) ?? []
		if (row.containerTag) tags.push(row.containerTag)
		tagsByDoc.set(row.documentId, tags)
	}

	return c.json({
		memories: docs.map((d) => ({
			...d,
			containerTags: tagsByDoc.get(d.id) ?? [],
			createdAt: d.createdAt.toISOString(),
			updatedAt: d.updatedAt.toISOString(),
		})),
		pagination: {
			currentPage: page,
			limit,
			totalItems,
			totalPages: Math.ceil(totalItems / limit),
		},
	})
})

// POST /documents/documents — Get documents with memory entries
documentsRoutes.post("/documents", async (c) => {
	const session = getSession(c)
	const body = await c.req.json()

	const page = body.page ?? 1
	const limit = Math.min(body.limit ?? 10, 100)
	const offset = (page - 1) * limit
	const orderDir = body.order === "asc" ? asc : desc
	const sortField =
		body.sort === "updatedAt" ? documents.updatedAt : documents.createdAt

	const conditions = [eq(documents.orgId, session.orgId)]

	if (body.containerTags?.length) {
		const spaceRows = await db
			.select({ id: spaces.id })
			.from(spaces)
			.where(
				and(
					eq(spaces.orgId, session.orgId),
					inArray(spaces.containerTag, body.containerTags),
				),
			)
		const spaceIds = spaceRows.map((s) => s.id)

		if (spaceIds.length > 0) {
			const docIds = await db
				.selectDistinct({ documentId: documentsToSpaces.documentId })
				.from(documentsToSpaces)
				.where(inArray(documentsToSpaces.spaceId, spaceIds))

			if (docIds.length > 0) {
				conditions.push(
					inArray(
						documents.id,
						docIds.map((d) => d.documentId),
					),
				)
			}
		}
	}

	const whereClause = and(...conditions)

	const [totalResult] = await db
		.select({ count: count() })
		.from(documents)
		.where(whereClause)

	const totalItems = totalResult?.count ?? 0

	const docs = await db
		.select()
		.from(documents)
		.where(whereClause)
		.orderBy(orderDir(sortField))
		.limit(limit)
		.offset(offset)

	// Fetch memory entries for each document
	const docIds = docs.map((d) => d.id)
	const memSources =
		docIds.length > 0
			? await db
					.select()
					.from(memoryDocumentSources)
					.innerJoin(
						memoryEntries,
						eq(memoryDocumentSources.memoryEntryId, memoryEntries.id),
					)
					.innerJoin(spaces, eq(memoryEntries.spaceId, spaces.id))
					.where(inArray(memoryDocumentSources.documentId, docIds))
			: []

	const memoriesByDoc = new Map<string, Array<Record<string, unknown>>>()
	for (const row of memSources) {
		const docId = row.memory_document_sources.documentId
		const list = memoriesByDoc.get(docId) ?? []
		list.push({
			...row.memory_entries,
			sourceAddedAt: row.memory_document_sources.addedAt,
			sourceRelevanceScore: row.memory_document_sources.relevanceScore,
			sourceMetadata: row.memory_document_sources.metadata,
			spaceContainerTag: row.spaces.containerTag,
		})
		memoriesByDoc.set(docId, list)
	}

	return c.json({
		documents: docs.map((d) => ({
			...d,
			createdAt: d.createdAt,
			updatedAt: d.updatedAt,
			memoryEntries: memoriesByDoc.get(d.id) ?? [],
		})),
		pagination: {
			currentPage: page,
			limit,
			totalItems,
			totalPages: Math.ceil(totalItems / limit),
		},
	})
})

// POST /documents/documents/by-ids — Get specific documents by ID
documentsRoutes.post("/documents/by-ids", async (c) => {
	const session = getSession(c)
	const body = await c.req.json()
	const { ids, by = "id" } = body

	if (!ids?.length) {
		return c.json({ documents: [], pagination: { currentPage: 1, limit: ids?.length ?? 0, totalItems: 0, totalPages: 0 } })
	}

	const field = by === "customId" ? documents.customId : documents.id
	const docs = await db
		.select()
		.from(documents)
		.where(and(eq(documents.orgId, session.orgId), inArray(field, ids)))

	return c.json({
		documents: docs.map((d) => ({ ...d, memoryEntries: [] })),
		pagination: {
			currentPage: 1,
			limit: ids.length,
			totalItems: docs.length,
			totalPages: 1,
		},
	})
})

// GET /documents/:id — Get a single document
documentsRoutes.get("/:id", async (c) => {
	const session = getSession(c)
	const id = c.req.param("id")

	const [doc] = await db
		.select()
		.from(documents)
		.where(and(eq(documents.id, id), eq(documents.orgId, session.orgId)))
		.limit(1)

	if (!doc) return c.json({ error: "Document not found" }, 404)
	return c.json(doc)
})

// DELETE /documents/:id — Delete a document
documentsRoutes.delete("/:id", async (c) => {
	const session = getSession(c)
	const id = c.req.param("id")

	await db
		.delete(documents)
		.where(and(eq(documents.id, id), eq(documents.orgId, session.orgId)))

	return c.body(null, 204)
})

// DELETE /documents/bulk — Bulk delete
documentsRoutes.delete("/bulk", async (c) => {
	const session = getSession(c)
	const body = await c.req.json()

	let deletedCount = 0

	if (body.ids?.length) {
		const result = await db
			.delete(documents)
			.where(
				and(eq(documents.orgId, session.orgId), inArray(documents.id, body.ids)),
			)
			.returning({ id: documents.id })

		deletedCount = result.length
	} else if (body.containerTags?.length) {
		// Find all documents in these spaces
		const spaceRows = await db
			.select({ id: spaces.id })
			.from(spaces)
			.where(
				and(
					eq(spaces.orgId, session.orgId),
					inArray(spaces.containerTag, body.containerTags),
				),
			)

		if (spaceRows.length > 0) {
			const docIds = await db
				.selectDistinct({ documentId: documentsToSpaces.documentId })
				.from(documentsToSpaces)
				.where(
					inArray(
						documentsToSpaces.spaceId,
						spaceRows.map((s) => s.id),
					),
				)

			if (docIds.length > 0) {
				const result = await db
					.delete(documents)
					.where(
						inArray(
							documents.id,
							docIds.map((d) => d.documentId),
						),
					)
					.returning({ id: documents.id })

				deletedCount = result.length
			}
		}
	}

	return c.json({
		success: true,
		deletedCount,
		containerTags: body.containerTags,
	})
})
