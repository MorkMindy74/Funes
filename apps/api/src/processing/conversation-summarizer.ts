/**
 * Conversation Summarizer — compresses long chat histories.
 *
 * Two modes inspired by Letta:
 * - sliding_window: keep N recent messages, summarize the rest
 * - full: summarize entire conversation into one block
 *
 * Summaries are stored in conversation_summaries table and injected
 * into the system prompt for continuity.
 */

import { eq, asc, desc } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { chatMessages, conversationSummaries } from "../db/schema.js"
import { env } from "../env.js"
import { logger } from "../logger.js"

type SummarizationMode = "none" | "sliding_window" | "full"

interface ConversationContext {
	summary: string | null
	recentMessages: Array<{ role: string; content: string }>
}

/**
 * Get conversation context: prior summary + recent messages after it.
 */
export async function getConversationContext(
	threadId: string,
): Promise<ConversationContext> {
	// Fetch latest summary for this thread
	const [latestSummary] = await db
		.select()
		.from(conversationSummaries)
		.where(eq(conversationSummaries.threadId, threadId))
		.orderBy(desc(conversationSummaries.createdAt))
		.limit(1)

	if (!latestSummary) {
		return { summary: null, recentMessages: [] }
	}

	// Fetch messages after the summary's last covered message
	const lastMessageId = latestSummary.messageRange?.lastMessageId
	let recentMessages: Array<{ role: string; content: string }> = []

	if (lastMessageId) {
		// Get the timestamp of the last summarized message
		const [lastMsg] = await db
			.select({ createdAt: chatMessages.createdAt })
			.from(chatMessages)
			.where(eq(chatMessages.id, lastMessageId))
			.limit(1)

		if (lastMsg) {
			const msgs = await db
				.select({ role: chatMessages.role, content: chatMessages.content })
				.from(chatMessages)
				.where(eq(chatMessages.threadId, threadId))
				.orderBy(asc(chatMessages.createdAt))

			// Filter to messages after the last summarized one
			const lastIdx = msgs.findIndex((_, i) => {
				// Simple approach: skip messages up to and including the count in the summary
				return i >= (latestSummary.messageRange?.messageCount ?? 0)
			})
			recentMessages = lastIdx >= 0 ? msgs.slice(lastIdx) : []
		}
	}

	return {
		summary: latestSummary.summary,
		recentMessages,
	}
}

/**
 * Summarize conversation if it exceeds the threshold.
 * Fire-and-forget — designed to run in onFinish callback.
 */
export async function summarizeConversation(
	threadId: string,
	mode?: SummarizationMode,
): Promise<void> {
	const effectiveMode = mode ?? (env.SUMMARIZATION_MODE as SummarizationMode)
	if (effectiveMode === "none") return

	const threshold = env.SUMMARIZATION_THRESHOLD

	try {
		// Fetch all messages for the thread
		const messages = await db
			.select({
				id: chatMessages.id,
				role: chatMessages.role,
				content: chatMessages.content,
				createdAt: chatMessages.createdAt,
			})
			.from(chatMessages)
			.where(eq(chatMessages.threadId, threadId))
			.orderBy(asc(chatMessages.createdAt))

		if (messages.length <= threshold) return

		// Check if we already have a summary covering most messages
		const [existing] = await db
			.select()
			.from(conversationSummaries)
			.where(eq(conversationSummaries.threadId, threadId))
			.orderBy(desc(conversationSummaries.createdAt))
			.limit(1)

		const alreadyCovered = existing?.messageRange?.messageCount ?? 0
		// Only re-summarize if we have enough new messages beyond the last summary
		if (
			alreadyCovered > 0 &&
			messages.length - alreadyCovered < Math.floor(threshold / 2)
		) {
			return
		}

		let summaryText: string
		let coveredCount: number

		if (effectiveMode === "sliding_window") {
			// Keep the last `threshold` messages, summarize the rest
			const toSummarize = messages.slice(0, messages.length - threshold)
			if (toSummarize.length === 0) return

			summaryText = await generateSummary(toSummarize, existing?.summary)
			coveredCount = messages.length - threshold
		} else {
			// Full mode: summarize everything except the last message
			const toSummarize = messages.slice(0, messages.length - 1)
			if (toSummarize.length === 0) return

			summaryText = await generateSummary(toSummarize, null)
			coveredCount = messages.length - 1
		}

		// Store the summary
		await db.insert(conversationSummaries).values({
			id: nanoid(),
			threadId,
			summary: summaryText,
			messageRange: {
				firstMessageId: messages[0].id,
				lastMessageId: messages[coveredCount - 1].id,
				messageCount: coveredCount,
			},
			mode: effectiveMode,
		})

		logger.info(
			{
				threadId,
				mode: effectiveMode,
				summarized: coveredCount,
				total: messages.length,
			},
			"Conversation summarized",
		)
	} catch (err) {
		logger.error({ err, threadId }, "Conversation summarization failed")
	}
}

/**
 * Generate a summary using Ollama, or a simple extractive fallback.
 */
async function generateSummary(
	messages: Array<{ role: string; content: string }>,
	priorSummary: string | null,
): Promise<string> {
	const transcript = messages
		.map((m) => `${m.role}: ${m.content}`)
		.join("\n")
		.slice(0, 8000) // Cap input size

	// Try Ollama
	if (env.OLLAMA_URL) {
		try {
			const prompt = priorSummary
				? `You are summarizing a conversation. Here is the prior summary:\n\n${priorSummary}\n\nHere are new messages to incorporate:\n\n${transcript}\n\nProvide an updated, comprehensive summary of the entire conversation so far. Focus on key topics, decisions, user preferences, and any actionable items. Be concise but thorough. Return ONLY the summary.`
				: `Summarize the following conversation. Focus on key topics, decisions, user preferences, and any actionable items. Be concise but thorough.\n\n${transcript}\n\nReturn ONLY the summary.`

			const response = await fetch(`${env.OLLAMA_URL}/api/generate`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: env.OLLAMA_MODEL,
					prompt,
					stream: false,
					options: { temperature: 0.3, num_predict: 500 },
				}),
				signal: AbortSignal.timeout(30_000),
			})

			if (response.ok) {
				const data = (await response.json()) as { response?: string }
				if (data.response?.trim()) {
					return data.response.trim()
				}
			}
		} catch (err) {
			logger.warn(
				{ err },
				"Ollama summarization failed — using extractive fallback",
			)
		}
	}

	// Extractive fallback: take first sentence of each user message
	const userMessages = messages.filter((m) => m.role === "user")
	const keyPoints = userMessages
		.map((m) => {
			const firstSentence = m.content.split(/[.!?]\s/)[0]
			return firstSentence.slice(0, 200)
		})
		.slice(0, 10)

	return `Conversation topics: ${keyPoints.join("; ")}`
}
