/**
 * Chat routes — SSE streaming with RAG (Retrieval-Augmented Generation).
 *
 * POST /          — Stream chat response with memory context
 * GET  /threads   — List chat threads for a project
 * GET  /threads/:id   — Get thread with messages
 * DELETE /threads/:id — Delete thread
 */

import { Hono } from "hono"
import { streamText, type CoreMessage } from "ai"
import { eq, and, desc } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { chatThreads, chatMessages } from "../db/schema.js"
import { getSession } from "../middleware/auth.js"
import { resolveModel, isLLMAvailable, getLLMInfo } from "../llm/provider.js"
import { generateEmbedding } from "../processing/embeddings.js"
import { searchChunks } from "../vector/lancedb.js"
import { retrieveMemoriesForRAG } from "../processing/memory-manager.js"
import { logger } from "../logger.js"

export const chatRoutes = new Hono()

// ─── RAG: Build context from user's memories ──────────────────────

async function buildRAGContext(
	query: string,
	orgId: string,
): Promise<string> {
	try {
		// Generate embedding for the query
		const embedding = await generateEmbedding(query)

		// Search both chunks and memories (confidence-weighted for memories)
		const [chunkResults, memoryResults] = await Promise.all([
			searchChunks(embedding, { limit: 5 }).catch(() => []),
			retrieveMemoriesForRAG(embedding, { limit: 8, minSimilarity: 0.25 }).catch(() => []),
		])

		const contextParts: string[] = []

		// Add relevant memories — grouped by level for clarity
		if (memoryResults.length > 0) {
			const coreMems = memoryResults.filter((m) => m.level === "core" || m.level === "profile")
			const otherMems = memoryResults.filter((m) => m.level !== "core" && m.level !== "profile")

			if (coreMems.length > 0) {
				contextParts.push("## Core Knowledge")
				for (const m of coreMems) {
					contextParts.push(`- ${m.memory} [${m.level}, confidence: ${Math.round(m.confidence * 100)}%]`)
				}
			}

			if (otherMems.length > 0) {
				contextParts.push("\n## Related Memories")
				for (const m of otherMems) {
					contextParts.push(`- ${m.memory} (relevance: ${Math.round(m.score * 100)}%)`)
				}
			}
		}

		// Add relevant document chunks
		const relevantChunks = chunkResults.filter((c) => c.score >= 0.3)
		if (relevantChunks.length > 0) {
			contextParts.push("\n## Relevant Documents")
			for (const c of relevantChunks) {
				contextParts.push(`---\n${c.content}\n(relevance: ${Math.round(c.score * 100)}%)`)
			}
		}

		if (contextParts.length === 0) {
			return ""
		}

		return (
			"\n\n<user_context>\n" +
			"The following information comes from the user's personal memory bank. " +
			"Core knowledge and profile traits are the most reliable. " +
			"Use this to provide personalized, contextual answers.\n\n" +
			contextParts.join("\n") +
			"\n</user_context>"
		)
	} catch (error) {
		logger.warn({ error }, "RAG context retrieval failed, proceeding without context")
		return ""
	}
}

// ─── System prompt ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Funes, a helpful AI assistant with access to the user's personal memory bank.
You can recall information the user has saved — notes, links, documents, and personal facts.

Guidelines:
- Be conversational and helpful
- Reference specific memories when relevant
- If you don't find relevant context, say so honestly
- When the user shares new information worth remembering, suggest they save it
- Keep responses concise unless asked for detail`

// ─── POST / — Streaming chat with RAG ─────────────────────────────

chatRoutes.post("/", async (c) => {
	const session = getSession(c)

	// Check LLM availability
	if (!isLLMAvailable()) {
		return c.json(
			{
				error: "No LLM configured",
				message:
					"Set OLLAMA_URL in your environment. Quick start: docker compose --profile with-ollama up",
				setup: {
					ollama: "OLLAMA_URL=http://ollama:11434",
					openai: "OPENAI_API_KEY=sk-...",
				},
			},
			503,
		)
	}

	const body = await c.req.json()
	const {
		messages = [],
		metadata = {},
	}: {
		messages: Array<{ role: string; content: string; parts?: unknown[] }>
		metadata: { chatId?: string; projectId?: string; model?: string }
	} = body

	const { chatId, projectId, model: requestedModel } = metadata

	if (!messages.length) {
		return c.json({ error: "No messages provided" }, 400)
	}

	// Get the last user message for RAG
	const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")
	const userQuery = lastUserMessage?.content ?? ""

	// Build RAG context
	const ragContext = await buildRAGContext(userQuery, session.orgId)

	// Resolve LLM model
	let resolved
	try {
		resolved = resolveModel(requestedModel)
	} catch (error) {
		return c.json(
			{
				error: "LLM not available",
				message: error instanceof Error ? error.message : "Unknown error",
			},
			503,
		)
	}

	logger.info(
		{ model: resolved.displayName, provider: resolved.provider, chatId, hasRAG: !!ragContext },
		"Chat request",
	)

	// Build message array for the AI SDK
	const systemPrompt = SYSTEM_PROMPT + ragContext

	const coreMessages: CoreMessage[] = messages.map((m) => ({
		role: m.role as "user" | "assistant" | "system",
		content:
			typeof m.content === "string"
				? m.content
				: // Handle parts-based messages from AI SDK
					(m.parts as Array<{ type: string; text?: string }>)
						?.filter((p) => p.type === "text")
						.map((p) => p.text)
						.join("") || "",
	}))

	// Stream the response
	const result = streamText({
		model: resolved.model,
		system: systemPrompt,
		messages: coreMessages,
		maxTokens: 4096,
		onFinish: async ({ text }) => {
			// Persist conversation to database
			try {
				if (chatId && text) {
					await persistConversation(
						chatId,
						session.orgId,
						session.user.id,
						userQuery,
						text,
						projectId,
					)
				}
			} catch (error) {
				logger.error({ error, chatId }, "Failed to persist chat message")
			}
		},
	})

	// Return AI SDK compatible streaming response
	return result.toDataStreamResponse({
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Credentials": "true",
		},
	})
})

// ─── Persist conversation to DB ────────────────────────────────────

async function persistConversation(
	chatId: string,
	orgId: string,
	userId: string,
	userMessage: string,
	assistantMessage: string,
	projectId?: string,
) {
	// Check if thread exists
	const existing = await db
		.select()
		.from(chatThreads)
		.where(eq(chatThreads.id, chatId))
		.limit(1)

	if (existing.length === 0) {
		// Create new thread — use first few words of user message as title
		const title = userMessage.length > 80 ? userMessage.slice(0, 77) + "..." : userMessage

		await db.insert(chatThreads).values({
			id: chatId,
			orgId,
			userId,
			title,
			metadata: projectId ? { projectId } : {},
		})
	}

	// Insert both messages
	const userMsgId = nanoid()
	const assistantMsgId = nanoid()

	await db.insert(chatMessages).values([
		{
			id: userMsgId,
			threadId: chatId,
			role: "user",
			content: userMessage,
		},
		{
			id: assistantMsgId,
			threadId: chatId,
			role: "assistant",
			content: assistantMessage,
		},
	])
}

// ─── GET /threads — List threads ───────────────────────────────────

chatRoutes.get("/threads", async (c) => {
	const session = getSession(c)
	const projectId = c.req.query("projectId")

	const threads = await db
		.select()
		.from(chatThreads)
		.where(eq(chatThreads.orgId, session.orgId))
		.orderBy(desc(chatThreads.updatedAt))
		.limit(50)

	// Filter by project if specified
	const filtered = projectId
		? threads.filter((t) => {
				const meta = t.metadata as Record<string, unknown> | null
				return meta?.projectId === projectId || !meta?.projectId
			})
		: threads

	return c.json({
		threads: filtered.map((t) => ({
			id: t.id,
			title: t.title,
			createdAt: t.createdAt.toISOString(),
			updatedAt: t.updatedAt.toISOString(),
		})),
	})
})

// ─── GET /threads/:id — Get thread with messages ───────────────────

chatRoutes.get("/threads/:id", async (c) => {
	const session = getSession(c)
	const threadId = c.req.param("id")

	// Verify ownership
	const thread = await db
		.select()
		.from(chatThreads)
		.where(and(eq(chatThreads.id, threadId), eq(chatThreads.orgId, session.orgId)))
		.limit(1)

	if (thread.length === 0) {
		return c.json({ error: "Thread not found" }, 404)
	}

	// Get messages
	const msgs = await db
		.select()
		.from(chatMessages)
		.where(eq(chatMessages.threadId, threadId))
		.orderBy(chatMessages.createdAt)

	return c.json({
		thread: {
			id: thread[0].id,
			title: thread[0].title,
			createdAt: thread[0].createdAt.toISOString(),
			updatedAt: thread[0].updatedAt.toISOString(),
		},
		messages: msgs.map((m) => ({
			id: m.id,
			role: m.role,
			content: m.content,
			parts: [{ type: "text", text: m.content }],
			createdAt: m.createdAt.toISOString(),
		})),
	})
})

// ─── DELETE /threads/:id — Delete thread ───────────────────────────

chatRoutes.delete("/threads/:id", async (c) => {
	const session = getSession(c)
	const threadId = c.req.param("id")

	// Verify ownership and delete (messages cascade via FK)
	const deleted = await db
		.delete(chatThreads)
		.where(and(eq(chatThreads.id, threadId), eq(chatThreads.orgId, session.orgId)))
		.returning()

	if (deleted.length === 0) {
		return c.json({ error: "Thread not found" }, 404)
	}

	return c.json({ success: true })
})

// ─── GET /status — LLM availability check ─────────────────────────

chatRoutes.get("/status", async (c) => {
	const info = getLLMInfo()

	// If Ollama is configured, check if it's actually reachable
	if (info.provider === "ollama") {
		try {
			const resp = await fetch(`${process.env.OLLAMA_URL}/api/tags`, {
				signal: AbortSignal.timeout(3000),
			})
			if (resp.ok) {
				const data = (await resp.json()) as { models?: Array<{ name: string }> }
				return c.json({
					...info,
					status: "connected",
					models: data.models?.map((m) => m.name) ?? [],
				})
			}
		} catch {
			return c.json({ ...info, status: "unreachable" })
		}
	}

	return c.json({
		...info,
		status: info.available ? "configured" : "not_configured",
	})
})
