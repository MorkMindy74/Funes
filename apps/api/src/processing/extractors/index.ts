/** Result of content extraction */
export interface ExtractResult {
	markdown: string
	title?: string
	sourceType?: string
}

/** Common interface for all extractors */
export interface Extractor {
	name: string
	extract(input: string | Buffer, options?: { filename?: string; mimeType?: string }): Promise<ExtractResult>
}

/** Check if input looks like a URL */
function isUrl(input: string | Buffer): boolean {
	return typeof input === "string" && /^https?:\/\//i.test(input.trim())
}

/**
 * Get the appropriate extractor based on content type and config.
 *
 * Priority:
 *   1. Firecrawl — for URLs, when FIRECRAWL_URL is set (JS rendering, boilerplate removal)
 *   2. OCR — for scanned docs, when OCR_PROVIDER is set (M7.3)
 *   3. MarkItDown — default fallback (handles URL, HTML, PDF, DOCX, etc.)
 */
export async function getExtractor(
	contentType?: string,
	config?: { firecrawlUrl?: string; ocrProvider?: string },
): Promise<Extractor> {
	// Firecrawl for URL extraction (JS rendering, clean markdown)
	if (config?.firecrawlUrl) {
		const { FirecrawlExtractor } = await import("./firecrawl.js")
		return new FirecrawlExtractor(config.firecrawlUrl)
	}

	// TODO (M7.3): OCR extractors
	// if (config?.ocrProvider === "glm-ocr") return new GlmOcrExtractor()
	// if (config?.ocrProvider === "chandra") return new ChandraExtractor()

	// Default: MarkItDown handles everything
	const { MarkItDownExtractor } = await import("./markitdown.js")
	return new MarkItDownExtractor()
}
