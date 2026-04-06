/**
 * Semantic chunker — splits markdown into overlapping chunks of ~500 tokens.
 * Uses paragraph and sentence boundaries for natural splits.
 */

const TARGET_CHUNK_SIZE = 500 // tokens (approximated as words * 1.3)
const MIN_CHUNK_SIZE = 100
const MAX_CHUNK_SIZE = 1000
const OVERLAP_CHARS = 150

export interface ChunkResult {
	content: string
	position: number
	type: "text" | "image"
	metadata?: Record<string, string | number | boolean>
}

/** Approximate token count (words × 1.3) */
function estimateTokens(text: string): number {
	return Math.ceil(text.split(/\s+/).length * 1.3)
}

/**
 * Split markdown content into semantic chunks with overlap.
 * Strategy: split on paragraphs first, then sentences if too large.
 */
export function chunkContent(markdown: string): ChunkResult[] {
	if (!markdown || markdown.trim().length === 0) return []

	// Split into paragraphs (double newline)
	const paragraphs = markdown.split(/\n{2,}/).filter((p) => p.trim().length > 0)

	const chunks: ChunkResult[] = []
	let currentChunk = ""
	let position = 0

	for (const para of paragraphs) {
		const paraTokens = estimateTokens(para)

		// If a single paragraph is too large, split by sentences
		if (paraTokens > MAX_CHUNK_SIZE) {
			// Flush current chunk first
			if (currentChunk.trim()) {
				chunks.push({
					content: currentChunk.trim(),
					position: position++,
					type: "text",
				})
				currentChunk = ""
			}

			// Split large paragraph into sentences
			const sentences = para.split(/(?<=[.!?])\s+/)
			let sentenceChunk = ""

			for (const sentence of sentences) {
				if (
					estimateTokens(`${sentenceChunk} ${sentence}`) > TARGET_CHUNK_SIZE &&
					sentenceChunk.trim()
				) {
					chunks.push({
						content: sentenceChunk.trim(),
						position: position++,
						type: "text",
					})
					// Overlap: keep last part of previous chunk
					const overlap = sentenceChunk.slice(-OVERLAP_CHARS)
					sentenceChunk = `${overlap} ${sentence}`
				} else {
					sentenceChunk += (sentenceChunk ? " " : "") + sentence
				}
			}

			if (sentenceChunk.trim()) {
				currentChunk = sentenceChunk
			}
			continue
		}

		// Check if adding this paragraph exceeds target
		if (
			estimateTokens(`${currentChunk}\n\n${para}`) > TARGET_CHUNK_SIZE &&
			currentChunk.trim()
		) {
			chunks.push({
				content: currentChunk.trim(),
				position: position++,
				type: "text",
			})
			// Overlap: keep last part of previous chunk
			const overlap = currentChunk.slice(-OVERLAP_CHARS)
			currentChunk = `${overlap}\n\n${para}`
		} else {
			currentChunk += (currentChunk ? "\n\n" : "") + para
		}
	}

	// Flush remaining
	if (currentChunk.trim()) {
		// If too small, merge with last chunk
		if (chunks.length > 0 && estimateTokens(currentChunk) < MIN_CHUNK_SIZE) {
			const last = chunks[chunks.length - 1]
			last.content += `\n\n${currentChunk.trim()}`
		} else {
			chunks.push({
				content: currentChunk.trim(),
				position: position++,
				type: "text",
			})
		}
	}

	return chunks
}
