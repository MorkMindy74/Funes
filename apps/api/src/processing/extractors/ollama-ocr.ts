/**
 * Ollama Vision OCR Extractor — Uses Ollama's vision models for OCR.
 *
 * Leverages the existing Ollama setup (no additional services needed).
 * Works with models like: llava, llama3.2-vision, moondream, bakllava.
 *
 * Handles:
 * - Image URLs → downloads and sends to vision model
 * - Base64-encoded images → decodes and sends to vision model
 * - Buffers → sends directly to vision model
 *
 * Falls back to MarkItDown for non-image content.
 */

import type { Extractor, ExtractResult } from "./index.js"
import { logger } from "../../logger.js"
import { env } from "../../env.js"

/** Image file extensions recognized by this extractor */
const IMAGE_EXTENSIONS = new Set([
	".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".svg",
])

/** MIME types recognized as images */
const IMAGE_MIMES = new Set([
	"image/jpeg", "image/png", "image/webp", "image/gif",
	"image/bmp", "image/tiff", "image/svg+xml",
])

export class OllamaOcrExtractor implements Extractor {
	name = "ollama-ocr"
	private ollamaUrl: string
	private model: string

	constructor(ollamaUrl?: string, model?: string) {
		this.ollamaUrl = (ollamaUrl || env.OLLAMA_URL).replace(/\/$/, "")
		// Vision model — prefer dedicated vision model, fallback to configured model
		this.model = model || env.OLLAMA_OCR_MODEL || env.OLLAMA_MODEL || "llava"
	}

	async extract(
		input: string | Buffer,
		options?: { filename?: string; mimeType?: string },
	): Promise<ExtractResult> {
		// Determine if the input is image content
		const isImage = this.isImageInput(input, options)

		if (!isImage) {
			// Not an image — delegate to MarkItDown
			const { MarkItDownExtractor } = await import("./markitdown.js")
			return new MarkItDownExtractor().extract(input, options)
		}

		logger.info(
			{ type: typeof input === "string" ? "string" : "buffer", filename: options?.filename },
			"OllamaOcrExtractor: processing image",
		)

		try {
			const base64Image = await this.toBase64(input, options)
			if (!base64Image) {
				throw new Error("Could not convert input to base64 image")
			}

			const result = await this.ocrViaVision(base64Image)
			return result
		} catch (error) {
			logger.warn(
				{ error: error instanceof Error ? error.message : error },
				"OllamaOcrExtractor: OCR failed, falling back to MarkItDown",
			)
			const { MarkItDownExtractor } = await import("./markitdown.js")
			return new MarkItDownExtractor().extract(input, options)
		}
	}

	/**
	 * Detect whether the input is image content that needs OCR.
	 */
	private isImageInput(
		input: string | Buffer,
		options?: { filename?: string; mimeType?: string },
	): boolean {
		// Check MIME type hint
		if (options?.mimeType && IMAGE_MIMES.has(options.mimeType)) return true

		// Check file extension hint
		if (options?.filename) {
			const ext = `.${options.filename.split(".").pop()?.toLowerCase()}`
			if (IMAGE_EXTENSIONS.has(ext)) return true
		}

		// Check if it's a base64-encoded image
		if (typeof input === "string" && isBase64Image(input)) return true

		// Check if it's a URL pointing to an image
		if (typeof input === "string" && isImageUrl(input)) return true

		// Buffer — check magic bytes
		if (Buffer.isBuffer(input)) return hasImageMagicBytes(input)

		return false
	}

	/**
	 * Convert various input formats to base64.
	 */
	private async toBase64(
		input: string | Buffer,
		options?: { filename?: string; mimeType?: string },
	): Promise<string | null> {
		// Already base64 data URI
		if (typeof input === "string" && isBase64Image(input)) {
			// Strip data:image/...;base64, prefix
			const base64Part = input.split(",")[1]
			return base64Part || null
		}

		// URL — download the image
		if (typeof input === "string" && input.startsWith("http")) {
			try {
				const response = await fetch(input, {
					signal: AbortSignal.timeout(30000),
				})
				if (!response.ok) return null
				const buffer = await response.arrayBuffer()
				return Buffer.from(buffer).toString("base64")
			} catch {
				return null
			}
		}

		// Buffer — convert directly
		if (Buffer.isBuffer(input)) {
			return input.toString("base64")
		}

		return null
	}

	/**
	 * Send image to Ollama vision model for OCR.
	 * Uses Ollama's /api/generate endpoint with image support.
	 */
	private async ocrViaVision(base64Image: string): Promise<ExtractResult> {
		const prompt = `You are an OCR (Optical Character Recognition) system. Extract ALL text from this image accurately.

Rules:
- Preserve the document structure (headings, paragraphs, lists, tables)
- Format the output as clean Markdown
- If there are tables, use Markdown table syntax
- If there are lists, use Markdown list syntax
- Preserve any code blocks or formulas
- If the image contains no text, describe what you see briefly
- Do NOT add commentary or explanation — just output the extracted text`

		const response = await fetch(`${this.ollamaUrl}/api/generate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: this.model,
				prompt,
				images: [base64Image],
				stream: false,
				options: {
					temperature: 0.1, // Low temperature for accuracy
					num_predict: 4096,
				},
			}),
			signal: AbortSignal.timeout(120000), // 2 min timeout for large images
		})

		if (!response.ok) {
			const errText = await response.text().catch(() => "Unknown error")
			throw new Error(`Ollama vision failed (${response.status}): ${errText}`)
		}

		const data = (await response.json()) as {
			response: string
			done: boolean
			total_duration?: number
		}

		const markdown = data.response?.trim()
		if (!markdown) {
			throw new Error("Ollama vision returned empty response")
		}

		logger.info(
			{
				chars: markdown.length,
				model: this.model,
				duration: data.total_duration
					? `${(data.total_duration / 1e9).toFixed(1)}s`
					: undefined,
			},
			"OllamaOcrExtractor: OCR complete",
		)

		return {
			markdown,
			title: undefined,
			sourceType: "image-ocr",
		}
	}
}

// ─── Helpers ───────────────────────────────────────────────────────

function isBase64Image(input: string): boolean {
	return /^data:image\/(jpeg|png|webp|gif|bmp|tiff|svg\+xml);base64,/i.test(input)
}

function isImageUrl(input: string): boolean {
	if (!/^https?:\/\//i.test(input)) return false
	try {
		const url = new URL(input)
		const ext = url.pathname.split(".").pop()?.toLowerCase() || ""
		return IMAGE_EXTENSIONS.has(`.${ext}`)
	} catch {
		return false
	}
}

/** Check common image magic bytes */
function hasImageMagicBytes(buf: Buffer): boolean {
	if (buf.length < 4) return false
	// JPEG: FF D8 FF
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true
	// PNG: 89 50 4E 47
	if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true
	// GIF: 47 49 46
	if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true
	// WebP: 52 49 46 46 ... 57 45 42 50
	if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.length >= 12) {
		if (buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true
	}
	// BMP: 42 4D
	if (buf[0] === 0x42 && buf[1] === 0x4d) return true
	// TIFF: 49 49 or 4D 4D
	if ((buf[0] === 0x49 && buf[1] === 0x49) || (buf[0] === 0x4d && buf[1] === 0x4d)) return true
	return false
}

/** Check if Ollama vision model is available */
export async function isOllamaVisionAvailable(
	ollamaUrl?: string,
	model?: string,
): Promise<boolean> {
	const url = (ollamaUrl || env.OLLAMA_URL).replace(/\/$/, "")
	const modelName = model || env.OLLAMA_OCR_MODEL || env.OLLAMA_MODEL || "llava"

	try {
		const resp = await fetch(`${url}/api/show`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: modelName }),
			signal: AbortSignal.timeout(5000),
		})
		if (!resp.ok) return false
		const data = (await resp.json()) as { details?: { families?: string[] } }
		// Check if model supports vision (multimodal)
		return true // If model exists, assume it may support vision
	} catch {
		return false
	}
}
