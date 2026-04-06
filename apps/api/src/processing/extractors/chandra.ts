/**
 * Chandra OCR Extractor — Self-hosted OCR via Chandra service.
 *
 * Chandra is a lightweight OCR microservice that can be self-hosted.
 * Expects a running Chandra instance at CHANDRA_URL.
 *
 * Docker: docker compose --profile with-chandra up
 *
 * Handles:
 * - Image URLs → downloads and sends to Chandra
 * - Base64-encoded images → decodes and sends to Chandra
 * - Buffers → sends directly to Chandra
 * - PDF files → sends for page-by-page OCR
 *
 * Falls back to MarkItDown for non-image/non-PDF content.
 */

import type { Extractor, ExtractResult } from "./index.js"
import { logger } from "../../logger.js"
import { env } from "../../env.js"

/** File types that Chandra can OCR */
const OCR_EXTENSIONS = new Set([
	".jpg",
	".jpeg",
	".png",
	".webp",
	".gif",
	".bmp",
	".tiff",
	".tif",
	".pdf", // Scanned PDFs
])

const IMAGE_MIMES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
	"image/bmp",
	"image/tiff",
	"application/pdf",
])

export class ChandraExtractor implements Extractor {
	name = "chandra"
	private baseUrl: string

	constructor(chandraUrl?: string) {
		this.baseUrl = (chandraUrl || env.CHANDRA_URL).replace(/\/$/, "")
	}

	async extract(
		input: string | Buffer,
		options?: { filename?: string; mimeType?: string },
	): Promise<ExtractResult> {
		const isOcrContent = this.isOcrContent(input, options)

		if (!isOcrContent) {
			const { MarkItDownExtractor } = await import("./markitdown.js")
			return new MarkItDownExtractor().extract(input, options)
		}

		logger.info(
			{
				type: typeof input === "string" ? "string" : "buffer",
				filename: options?.filename,
			},
			"ChandraExtractor: processing document",
		)

		try {
			const result = await this.performOcr(input, options)
			return result
		} catch (error) {
			logger.warn(
				{ error: error instanceof Error ? error.message : error },
				"ChandraExtractor: OCR failed, falling back to MarkItDown",
			)
			const { MarkItDownExtractor } = await import("./markitdown.js")
			return new MarkItDownExtractor().extract(input, options)
		}
	}

	private isOcrContent(
		input: string | Buffer,
		options?: { filename?: string; mimeType?: string },
	): boolean {
		if (options?.mimeType && IMAGE_MIMES.has(options.mimeType)) return true
		if (options?.filename) {
			const ext = `.${options.filename.split(".").pop()?.toLowerCase()}`
			if (OCR_EXTENSIONS.has(ext)) return true
		}
		if (typeof input === "string" && /^data:image\//i.test(input)) return true
		if (typeof input === "string" && isImageUrl(input)) return true
		if (Buffer.isBuffer(input)) return true // Buffers are likely binary files
		return false
	}

	/**
	 * Send content to Chandra for OCR.
	 * Chandra expects multipart/form-data with the file.
	 */
	private async performOcr(
		input: string | Buffer,
		options?: { filename?: string; mimeType?: string },
	): Promise<ExtractResult> {
		let fileBuffer: Buffer
		let filename = options?.filename || "document"
		let mimeType = options?.mimeType || "application/octet-stream"

		if (Buffer.isBuffer(input)) {
			fileBuffer = input
		} else if (typeof input === "string" && /^data:/.test(input)) {
			// Base64 data URI
			const matches = input.match(/^data:([^;]+);base64,(.+)$/)
			if (matches) {
				mimeType = matches[1]
				fileBuffer = Buffer.from(matches[2], "base64")
			} else {
				throw new Error("Invalid base64 data URI")
			}
		} else if (typeof input === "string" && input.startsWith("http")) {
			// Download URL
			const resp = await fetch(input, { signal: AbortSignal.timeout(30000) })
			if (!resp.ok) throw new Error(`Failed to download: ${resp.status}`)
			fileBuffer = Buffer.from(await resp.arrayBuffer())
			// Try to get content type from response
			mimeType = resp.headers.get("content-type") || mimeType
			// Extract filename from URL
			try {
				const url = new URL(input)
				filename = url.pathname.split("/").pop() || filename
			} catch {
				/* keep default */
			}
		} else {
			throw new Error("Unsupported input format for Chandra OCR")
		}

		// Build multipart form data
		const formData = new FormData()
		const blob = new Blob([fileBuffer], { type: mimeType })
		formData.append("file", blob, filename)
		formData.append("output_format", "markdown")

		const response = await fetch(`${this.baseUrl}/ocr`, {
			method: "POST",
			body: formData,
			signal: AbortSignal.timeout(120000), // 2 min for large docs
		})

		if (!response.ok) {
			const errText = await response.text().catch(() => "Unknown error")
			throw new Error(`Chandra OCR failed (${response.status}): ${errText}`)
		}

		const data = (await response.json()) as {
			text?: string
			markdown?: string
			pages?: Array<{ text: string; page: number }>
			metadata?: { title?: string; pages?: number }
		}

		// Chandra may return text in different fields depending on version
		let markdown = data.markdown || data.text || ""

		// If pages are returned separately, join them
		if (!markdown && data.pages?.length) {
			markdown = data.pages
				.map((p) => `## Page ${p.page}\n\n${p.text}`)
				.join("\n\n---\n\n")
		}

		if (!markdown.trim()) {
			throw new Error("Chandra returned empty OCR result")
		}

		logger.info(
			{ chars: markdown.length, pages: data.metadata?.pages },
			"ChandraExtractor: OCR complete",
		)

		return {
			markdown,
			title: data.metadata?.title,
			sourceType: "ocr",
		}
	}
}

function isImageUrl(input: string): boolean {
	if (!/^https?:\/\//i.test(input)) return false
	try {
		const url = new URL(input)
		const ext = `.${url.pathname.split(".").pop()?.toLowerCase()}`
		return OCR_EXTENSIONS.has(ext)
	} catch {
		return false
	}
}

/** Check if Chandra service is reachable */
export async function isChandraAvailable(
	chandraUrl?: string,
): Promise<boolean> {
	const url = (chandraUrl || env.CHANDRA_URL).replace(/\/$/, "")
	if (!url) return false

	try {
		const resp = await fetch(`${url}/health`, {
			signal: AbortSignal.timeout(3000),
		}).catch(() => null)
		return !!resp?.ok
	} catch {
		return false
	}
}
