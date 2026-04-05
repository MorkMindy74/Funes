import { Hono } from "hono"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "../db/index.js"
import { connections, spaces } from "../db/schema.js"
import { getSession } from "../middleware/auth.js"

export const connectionsRoutes = new Hono()

// POST /:provider — Initiate connection (stub for M7)
connectionsRoutes.post("/:provider", async (c) => {
	const provider = c.req.param("provider")

	return c.json(
		{
			error: `Connection to ${provider} is not yet available in self-hosted mode. Coming in Milestone 7.`,
		},
		501,
	)
})

// POST /list — List connections
connectionsRoutes.post("/list", async (c) => {
	const session = getSession(c)

	const conns = await db
		.select()
		.from(connections)
		.where(eq(connections.orgId, session.orgId))

	return c.json(
		conns.map((conn) => ({
			id: conn.id,
			provider: conn.provider,
			email: conn.email,
			documentLimit: conn.documentLimit,
			containerTags: conn.containerTags,
			metadata: conn.metadata,
			expiresAt: conn.expiresAt?.toISOString(),
			createdAt: conn.createdAt.toISOString(),
		})),
	)
})

// GET / — Get all connections
connectionsRoutes.get("/", async (c) => {
	const session = getSession(c)

	const conns = await db
		.select()
		.from(connections)
		.where(eq(connections.orgId, session.orgId))

	return c.json(
		conns.map((conn) => ({
			id: conn.id,
			provider: conn.provider,
			email: conn.email,
			documentLimit: conn.documentLimit,
			containerTags: conn.containerTags,
			metadata: conn.metadata,
			expiresAt: conn.expiresAt?.toISOString(),
			createdAt: conn.createdAt.toISOString(),
		})),
	)
})

// GET /:connectionId — Get single connection
connectionsRoutes.get("/:connectionId", async (c) => {
	const session = getSession(c)
	const connectionId = c.req.param("connectionId")

	const [conn] = await db
		.select()
		.from(connections)
		.where(
			and(eq(connections.id, connectionId), eq(connections.orgId, session.orgId)),
		)
		.limit(1)

	if (!conn) return c.json({ error: "Connection not found" }, 404)

	return c.json({
		id: conn.id,
		provider: conn.provider,
		email: conn.email,
		documentLimit: conn.documentLimit,
		containerTags: conn.containerTags,
		metadata: conn.metadata,
		expiresAt: conn.expiresAt?.toISOString(),
		createdAt: conn.createdAt.toISOString(),
	})
})

// DELETE /:connectionId — Delete a connection
connectionsRoutes.delete("/:connectionId", async (c) => {
	const session = getSession(c)
	const connectionId = c.req.param("connectionId")

	const [conn] = await db
		.delete(connections)
		.where(
			and(eq(connections.id, connectionId), eq(connections.orgId, session.orgId)),
		)
		.returning({ id: connections.id, provider: connections.provider })

	if (!conn) return c.json({ error: "Connection not found" }, 404)

	return c.json({ id: conn.id, provider: conn.provider })
})
