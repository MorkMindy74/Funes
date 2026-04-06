import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"

// ─── Documents ──────────────────────────────────────────────────────
export const documents = pgTable(
	"documents",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		customId: varchar("custom_id", { length: 255 }),
		contentHash: varchar("content_hash", { length: 64 }),

		// Ownership
		orgId: varchar("org_id", { length: 36 }).notNull(),
		userId: varchar("user_id", { length: 36 }).notNull(),
		connectionId: varchar("connection_id", { length: 36 }),

		// Content
		title: text("title"),
		content: text("content"),
		summary: text("summary"),
		url: text("url"),
		source: varchar("source", { length: 100 }),
		type: varchar("type", { length: 50 }).notNull().default("text"),
		status: varchar("status", { length: 50 }).notNull().default("queued"),

		// Metadata
		metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>(),
		processingMetadata: jsonb("processing_metadata").$type<{
			startTime?: number
			endTime?: number
			duration?: number
			error?: string
			finalStatus?: string
			chunkingStrategy?: string
			tokenCount?: number
			steps?: Array<{
				name: string
				startTime: number
				endTime?: number
				status: string
				error?: string
				metadata?: Record<string, unknown>
			}>
		}>(),
		raw: text("raw"),
		ogImage: text("og_image"),

		// Stats
		tokenCount: integer("token_count"),
		wordCount: integer("word_count"),
		chunkCount: integer("chunk_count").notNull().default(0),
		averageChunkSize: integer("average_chunk_size"),

		// Embeddings
		summaryEmbedding: jsonb("summary_embedding").$type<number[]>(),
		summaryEmbeddingModel: varchar("summary_embedding_model", { length: 100 }),

		// Timestamps
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("documents_org_id_idx").on(table.orgId),
		index("documents_user_id_idx").on(table.userId),
		index("documents_status_idx").on(table.status),
		index("documents_connection_id_idx").on(table.connectionId),
		uniqueIndex("documents_custom_id_org_idx").on(table.customId, table.orgId),
		index("documents_created_at_idx").on(table.createdAt),
	],
)

// ─── Chunks ───────���─────────────────────────────────────────────────
export const chunks = pgTable(
	"chunks",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		documentId: varchar("document_id", { length: 36 })
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),

		content: text("content").notNull(),
		embeddedContent: text("embedded_content"),
		type: varchar("type", { length: 20 }).notNull().default("text"),
		position: integer("position").notNull(),
		metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>(),

		// Embeddings
		embedding: jsonb("embedding").$type<number[]>(),
		embeddingModel: varchar("embedding_model", { length: 100 }),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("chunks_document_id_idx").on(table.documentId),
		index("chunks_position_idx").on(table.documentId, table.position),
	],
)

// ─── Spaces (Projects) ─────────────────────────────────────────────
export const spaces = pgTable(
	"spaces",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		name: varchar("name", { length: 255 }),
		description: text("description"),
		orgId: varchar("org_id", { length: 36 }).notNull(),
		ownerId: varchar("owner_id", { length: 36 }).notNull(),
		containerTag: varchar("container_tag", { length: 255 }),
		visibility: varchar("visibility", { length: 20 }).notNull().default("private"),
		isExperimental: boolean("is_experimental").notNull().default(false),
		emoji: varchar("emoji", { length: 10 }),

		metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>(),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("spaces_org_id_idx").on(table.orgId),
		uniqueIndex("spaces_container_tag_org_idx").on(table.containerTag, table.orgId),
	],
)

// ─── Memory Entries ─────────────────────────────────────────────────
export const memoryEntries = pgTable(
	"memory_entries",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		memory: text("memory").notNull(),
		spaceId: varchar("space_id", { length: 36 })
			.notNull()
			.references(() => spaces.id, { onDelete: "cascade" }),
		orgId: varchar("org_id", { length: 36 }).notNull(),
		userId: varchar("user_id", { length: 36 }),

		// Version control
		version: integer("version").notNull().default(1),
		isLatest: boolean("is_latest").notNull().default(true),
		parentMemoryId: varchar("parent_memory_id", { length: 36 }),
		rootMemoryId: varchar("root_memory_id", { length: 36 }),

		// Relations: { "mem_id": "updates" | "extends" | "derives" }
		memoryRelations: jsonb("memory_relations").$type<Record<string, string>>().default({}),

		// Source tracking
		sourceCount: integer("source_count").notNull().default(1),

		// Status flags
		isInference: boolean("is_inference").notNull().default(false),
		isForgotten: boolean("is_forgotten").notNull().default(false),
		isStatic: boolean("is_static").notNull().default(false),
		forgetAfter: timestamp("forget_after", { withTimezone: true }),
		forgetReason: text("forget_reason"),

		// Confidence (predisposto per M7.4 — pattern EverMemOS)
		confidence: real("confidence").default(1.0),
		memoryLevel: varchar("memory_level", { length: 20 }).default("fact"),

		// Embeddings
		memoryEmbedding: jsonb("memory_embedding").$type<number[]>(),
		memoryEmbeddingModel: varchar("memory_embedding_model", { length: 100 }),

		metadata: jsonb("metadata").$type<Record<string, unknown>>(),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("memory_entries_space_id_idx").on(table.spaceId),
		index("memory_entries_org_id_idx").on(table.orgId),
		index("memory_entries_is_latest_idx").on(table.isLatest),
		index("memory_entries_is_static_idx").on(table.isStatic),
	],
)

// ──��� Memory ↔ Document Sources ──────────────────────────────────────
export const memoryDocumentSources = pgTable(
	"memory_document_sources",
	{
		memoryEntryId: varchar("memory_entry_id", { length: 36 })
			.notNull()
			.references(() => memoryEntries.id, { onDelete: "cascade" }),
		documentId: varchar("document_id", { length: 36 })
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		relevanceScore: real("relevance_score").notNull().default(100),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("mds_memory_entry_id_idx").on(table.memoryEntryId),
		index("mds_document_id_idx").on(table.documentId),
	],
)

// ─── Documents ↔ Spaces (many-to-many) ─────────────────────────────
export const documentsToSpaces = pgTable(
	"documents_to_spaces",
	{
		documentId: varchar("document_id", { length: 36 })
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		spaceId: varchar("space_id", { length: 36 })
			.notNull()
			.references(() => spaces.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("dts_document_id_idx").on(table.documentId),
		index("dts_space_id_idx").on(table.spaceId),
	],
)

// ─── Connections ─────���────────────────────────────────��─────────────
export const connections = pgTable(
	"connections",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		provider: varchar("provider", { length: 50 }).notNull(),
		orgId: varchar("org_id", { length: 36 }).notNull(),
		userId: varchar("user_id", { length: 36 }).notNull(),
		email: varchar("email", { length: 255 }),
		documentLimit: integer("document_limit").notNull().default(10000),
		containerTags: jsonb("container_tags").$type<string[]>(),

		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		expiresAt: timestamp("expires_at", { withTimezone: true }),

		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("connections_org_id_idx").on(table.orgId),
		index("connections_provider_idx").on(table.provider),
	],
)

// ─── Organization Settings ──────────��───────────────────────────────
export const organizationSettings = pgTable("organization_settings", {
	id: varchar("id", { length: 36 }).primaryKey(),
	orgId: varchar("org_id", { length: 36 }).notNull().unique(),

	// LLM Filtering
	shouldLLMFilter: boolean("should_llm_filter").notNull().default(false),
	filterPrompt: text("filter_prompt"),
	includeItems: jsonb("include_items").$type<string[]>(),
	excludeItems: jsonb("exclude_items").$type<string[]>(),

	// OAuth custom keys (per provider)
	googleDriveCustomKeyEnabled: boolean("google_drive_custom_key_enabled").notNull().default(false),
	googleDriveClientId: text("google_drive_client_id"),
	googleDriveClientSecret: text("google_drive_client_secret"),

	notionCustomKeyEnabled: boolean("notion_custom_key_enabled").notNull().default(false),
	notionClientId: text("notion_client_id"),
	notionClientSecret: text("notion_client_secret"),

	onedriveCustomKeyEnabled: boolean("onedrive_custom_key_enabled").notNull().default(false),
	onedriveClientId: text("onedrive_client_id"),
	onedriveClientSecret: text("onedrive_client_secret"),

	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

// ─── API Requests (analytics) ───────────────────────────────────────
export const apiRequests = pgTable(
	"api_requests",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		type: varchar("type", { length: 50 }).notNull(),
		orgId: varchar("org_id", { length: 36 }).notNull(),
		userId: varchar("user_id", { length: 36 }).notNull(),
		keyId: varchar("key_id", { length: 36 }),
		statusCode: integer("status_code").notNull(),
		duration: integer("duration"),

		input: jsonb("input").$type<Record<string, unknown>>(),
		output: jsonb("output").$type<Record<string, unknown>>(),

		originalTokens: integer("original_tokens"),
		finalTokens: integer("final_tokens"),
		tokensSaved: integer("tokens_saved"),
		costSavedUSD: real("cost_saved_usd"),

		model: varchar("model", { length: 100 }),
		provider: varchar("provider", { length: 100 }),
		conversationId: varchar("conversation_id", { length: 36 }),
		contextModified: boolean("context_modified").notNull().default(false),

		metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>(),
		origin: varchar("origin", { length: 50 }).notNull().default("api"),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("api_requests_org_id_idx").on(table.orgId),
		index("api_requests_type_idx").on(table.type),
		index("api_requests_created_at_idx").on(table.createdAt),
	],
)

// ─── Knowledge Graph (M7.5) ───────────────────────────────────────
export const graphNodes = pgTable(
	"graph_nodes",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		name: text("name").notNull(),
		type: varchar("type", { length: 50 }).notNull(), // person, org, location, concept, event, tool
		orgId: varchar("org_id", { length: 36 }).notNull(),
		spaceId: varchar("space_id", { length: 36 }).references(() => spaces.id, { onDelete: "set null" }),

		// Optional embedding for vector search over entities
		embedding: jsonb("embedding").$type<number[]>(),
		embeddingModel: varchar("embedding_model", { length: 100 }),

		// Properties bag — type-specific attributes
		properties: jsonb("properties").$type<Record<string, unknown>>().default({}),

		// Provenance
		sourceMemoryId: varchar("source_memory_id", { length: 36 }),
		sourceDocumentId: varchar("source_document_id", { length: 36 }),
		confidence: real("confidence").default(1.0),
		mentionCount: integer("mention_count").notNull().default(1),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("graph_nodes_org_id_idx").on(table.orgId),
		index("graph_nodes_type_idx").on(table.type),
		index("graph_nodes_name_idx").on(table.name),
		uniqueIndex("graph_nodes_name_type_org_idx").on(table.name, table.type, table.orgId),
	],
)

export const graphEdges = pgTable(
	"graph_edges",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		sourceId: varchar("source_id", { length: 36 })
			.notNull()
			.references(() => graphNodes.id, { onDelete: "cascade" }),
		targetId: varchar("target_id", { length: 36 })
			.notNull()
			.references(() => graphNodes.id, { onDelete: "cascade" }),
		relation: varchar("relation", { length: 100 }).notNull(), // works_at, lives_in, knows, created, etc.
		orgId: varchar("org_id", { length: 36 }).notNull(),

		// Scoring
		confidence: real("confidence").default(1.0),
		weight: real("weight").default(1.0),

		// Provenance
		sourceMemoryId: varchar("source_memory_id", { length: 36 }),
		sourceDocumentId: varchar("source_document_id", { length: 36 }),

		properties: jsonb("properties").$type<Record<string, unknown>>().default({}),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("graph_edges_source_idx").on(table.sourceId),
		index("graph_edges_target_idx").on(table.targetId),
		index("graph_edges_relation_idx").on(table.relation),
		index("graph_edges_org_id_idx").on(table.orgId),
		uniqueIndex("graph_edges_unique_idx").on(table.sourceId, table.targetId, table.relation),
	],
)

// ─── Chat Threads ──────────────────────────────────────────────────
export const chatThreads = pgTable(
	"chat_threads",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		orgId: varchar("org_id", { length: 36 }).notNull(),
		userId: varchar("user_id", { length: 36 }).notNull(),
		title: varchar("title", { length: 500 }),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index("chat_threads_org_id_idx").on(table.orgId)],
)

// ─── Chat Messages ─────────���────────────────────────────────────────
export const chatMessages = pgTable(
	"chat_messages",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		threadId: varchar("thread_id", { length: 36 })
			.notNull()
			.references(() => chatThreads.id, { onDelete: "cascade" }),
		role: varchar("role", { length: 20 }).notNull(),
		content: text("content").notNull(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index("chat_messages_thread_id_idx").on(table.threadId)],
)

// ─── Conversation Summaries ─────────────────────────────────────────
export const conversationSummaries = pgTable(
	"conversation_summaries",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		threadId: varchar("thread_id", { length: 36 })
			.notNull()
			.references(() => chatThreads.id, { onDelete: "cascade" }),
		summary: text("summary").notNull(),
		messageRange: jsonb("message_range").$type<{
			firstMessageId: string
			lastMessageId: string
			messageCount: number
		}>(),
		mode: varchar("mode", { length: 20 }).notNull(), // "sliding_window" | "full"
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index("conversation_summaries_thread_id_idx").on(table.threadId)],
)

// ─── Relations ────��─────────────────────────────────────────────────
export const documentsRelations = relations(documents, ({ many }) => ({
	chunks: many(chunks),
	spaces: many(documentsToSpaces),
	memorySources: many(memoryDocumentSources),
}))

export const chunksRelations = relations(chunks, ({ one }) => ({
	document: one(documents, {
		fields: [chunks.documentId],
		references: [documents.id],
	}),
}))

export const spacesRelations = relations(spaces, ({ many }) => ({
	documents: many(documentsToSpaces),
	memoryEntries: many(memoryEntries),
}))

export const memoryEntriesRelations = relations(memoryEntries, ({ one, many }) => ({
	space: one(spaces, {
		fields: [memoryEntries.spaceId],
		references: [spaces.id],
	}),
	documentSources: many(memoryDocumentSources),
}))

export const documentsToSpacesRelations = relations(documentsToSpaces, ({ one }) => ({
	document: one(documents, {
		fields: [documentsToSpaces.documentId],
		references: [documents.id],
	}),
	space: one(spaces, {
		fields: [documentsToSpaces.spaceId],
		references: [spaces.id],
	}),
}))

export const memoryDocumentSourcesRelations = relations(memoryDocumentSources, ({ one }) => ({
	memoryEntry: one(memoryEntries, {
		fields: [memoryDocumentSources.memoryEntryId],
		references: [memoryEntries.id],
	}),
	document: one(documents, {
		fields: [memoryDocumentSources.documentId],
		references: [documents.id],
	}),
}))

export const graphNodesRelations = relations(graphNodes, ({ many, one }) => ({
	outgoingEdges: many(graphEdges, { relationName: "sourceEdges" }),
	incomingEdges: many(graphEdges, { relationName: "targetEdges" }),
	space: one(spaces, { fields: [graphNodes.spaceId], references: [spaces.id] }),
}))

export const graphEdgesRelations = relations(graphEdges, ({ one }) => ({
	source: one(graphNodes, {
		fields: [graphEdges.sourceId],
		references: [graphNodes.id],
		relationName: "sourceEdges",
	}),
	target: one(graphNodes, {
		fields: [graphEdges.targetId],
		references: [graphNodes.id],
		relationName: "targetEdges",
	}),
}))
