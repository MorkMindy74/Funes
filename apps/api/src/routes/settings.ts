import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { organizationSettings } from "../db/schema.js"
import { getSession } from "../middleware/auth.js"

export const settingsRoutes = new Hono()

// GET / — Get organization settings
settingsRoutes.get("/", async (c) => {
	const session = getSession(c)

	const [settings] = await db
		.select()
		.from(organizationSettings)
		.where(eq(organizationSettings.orgId, session.orgId))
		.limit(1)

	if (!settings) {
		return c.json({ settings: {} })
	}

	return c.json({
		settings: {
			shouldLLMFilter: settings.shouldLLMFilter,
			filterPrompt: settings.filterPrompt,
			includeItems: settings.includeItems,
			excludeItems: settings.excludeItems,
		},
	})
})

// PATCH / — Update organization settings
settingsRoutes.patch("/", async (c) => {
	const session = getSession(c)
	const body = await c.req.json()

	const existing = await db
		.select()
		.from(organizationSettings)
		.where(eq(organizationSettings.orgId, session.orgId))
		.limit(1)

	const values = {
		shouldLLMFilter: body.shouldLLMFilter,
		filterPrompt: body.filterPrompt,
		includeItems: body.includeItems,
		excludeItems: body.excludeItems,
		googleDriveCustomKeyEnabled: body.googleDriveCustomKeyEnabled,
		googleDriveClientId: body.googleDriveClientId,
		googleDriveClientSecret: body.googleDriveClientSecret,
		notionCustomKeyEnabled: body.notionCustomKeyEnabled,
		notionClientId: body.notionClientId,
		notionClientSecret: body.notionClientSecret,
		onedriveCustomKeyEnabled: body.onedriveCustomKeyEnabled,
		onedriveClientId: body.onedriveClientId,
		onedriveClientSecret: body.onedriveClientSecret,
		updatedAt: new Date(),
	}

	if (existing.length > 0) {
		await db
			.update(organizationSettings)
			.set(values)
			.where(eq(organizationSettings.orgId, session.orgId))
	} else {
		await db.insert(organizationSettings).values({
			id: nanoid(),
			orgId: session.orgId,
			...values,
		})
	}

	return c.json({
		message: "Settings updated",
		settings: {
			shouldLLMFilter: body.shouldLLMFilter,
			filterPrompt: body.filterPrompt,
			includeItems: body.includeItems,
			excludeItems: body.excludeItems,
		},
	})
})
