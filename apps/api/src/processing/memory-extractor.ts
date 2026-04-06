/**
 * Memory Extractor — extracts key facts from document chunks.
 *
 * Without LLM (default): Uses compromise.js NLP to extract key sentences.
 * With Ollama (optional): Sends chunks to local LLM for intelligent extraction.
 *
 * Predisposto per M7.4 pattern EverMemOS (multi-level memory, confidence ranking).
 */

import { MemoryLevel, type ExtractedMemory } from "./memory-types.js"
import { env } from "../env.js"
import { logger } from "../logger.js"

/**
 * Extract memories from document content (chunks concatenated or summary).
 * Returns an array of memories with confidence scores.
 */
export async function extractMemories(
	content: string,
	options?: { title?: string; url?: string },
): Promise<ExtractedMemory[]> {
	if (!content || content.trim().length < 50) return []

	// If Ollama is configured, use LLM extraction
	if (env.OLLAMA_URL) {
		try {
			return await extractWithOllama(content, options)
		} catch (err) {
			logger.warn({ err }, "Ollama extraction failed, falling back to NLP")
		}
	}

	// Default: NLP-based extraction using compromise.js
	return extractWithNLP(content, options)
}

/**
 * NLP-based extraction — extracts key sentences using compromise.js.
 * Simple but effective for basic fact extraction.
 */
async function extractWithNLP(
	content: string,
	options?: { title?: string; url?: string },
): Promise<ExtractedMemory[]> {
	const nlp = (await import("compromise")).default
	const memories: ExtractedMemory[] = []

	// If there's a title, it's a strong memory
	if (options?.title) {
		memories.push({
			memory: options.url ? `${options.title} (${options.url})` : options.title,
			level: MemoryLevel.FACT,
			confidence: 0.9,
			isStatic: false,
		})
	}

	// Extract key sentences — look for sentences with proper nouns, numbers, or specific facts
	const doc = nlp(content)

	// Get sentences containing entities (people, places, organizations)
	const sentences = doc.sentences().json() as Array<{ text: string }>
	const keyPhrases = new Set<string>()

	for (const s of sentences.slice(0, 50)) {
		const sentence = s.text.trim()
		if (sentence.length < 20 || sentence.length > 500) continue

		const sentDoc = nlp(sentence)
		const hasEntity =
			(sentDoc as any).people?.().length > 0 ||
			(sentDoc as any).places?.().length > 0 ||
			(sentDoc as any).organizations?.().length > 0

		const hasNumber = /\d+/.test(sentence)
		const hasDefinition =
			/\b(is|are|was|were|means|refers to|defined as)\b/i.test(sentence)

		if (hasEntity || hasNumber || hasDefinition) {
			if (!keyPhrases.has(sentence)) {
				keyPhrases.add(sentence)
				memories.push({
					memory: sentence,
					level: MemoryLevel.FACT,
					confidence: hasEntity ? 0.7 : 0.5,
					isStatic: false,
				})
			}
		}

		// Limit to 10 memories per document
		if (memories.length >= 10) break
	}

	return memories
}

/**
 * LLM-based extraction via Ollama — more intelligent, classifies memory levels.
 */
async function extractWithOllama(
	content: string,
	options?: { title?: string; url?: string },
): Promise<ExtractedMemory[]> {
	const prompt = `Extract the most important facts and insights from this document. Return a JSON array of objects with: memory (string), level (one of: fact, preference, profile, episodic, core), confidence (0.0-1.0), isStatic (boolean).

Title: ${options?.title ?? "Unknown"}
URL: ${options?.url ?? "N/A"}

Content (truncated to 3000 chars):
${content.slice(0, 3000)}

Return ONLY valid JSON array, no markdown, no explanation.`

	const response = await fetch(`${env.OLLAMA_URL}/api/generate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: env.OLLAMA_MODEL,
			prompt,
			stream: false,
			format: "json",
		}),
	})

	if (!response.ok) {
		throw new Error(`Ollama returned ${response.status}`)
	}

	const data = (await response.json()) as { response: string }

	try {
		const parsed = JSON.parse(data.response)
		const arr = Array.isArray(parsed) ? parsed : (parsed.memories ?? [])

		return arr.slice(0, 15).map((m: any) => ({
			memory: String(m.memory ?? m.text ?? ""),
			level: Object.values(MemoryLevel).includes(m.level)
				? m.level
				: MemoryLevel.FACT,
			confidence:
				typeof m.confidence === "number"
					? Math.min(1, Math.max(0, m.confidence))
					: 0.6,
			isStatic: m.isStatic === true,
			metadata: m.metadata,
		}))
	} catch {
		logger.warn("Failed to parse Ollama response as JSON")
		return []
	}
}
