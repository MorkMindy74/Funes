import type { MarkItDownExtractor } from "./markitdown.js"

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

/**
 * Get the appropriate extractor based on content type and config.
 * Default: MarkItDown (handles URL, HTML, PDF, DOCX, etc.)
 * Future (M7): Firecrawl for JS-heavy sites, GLM-OCR/Chandra for scanned docs
 */
export async function getExtractor(
	_contentType?: string,
	_config?: { firecrawlUrl?: string; ocrProvider?: string },
): Promise<Extractor> {
	// TODO (M7): Check config for Firecrawl/OCR providers
	// if (config?.firecrawlUrl && isUrl(input)) return new FirecrawlExtractor(config.firecrawlUrl)
	// if (config?.ocrProvider === "glm-ocr") return new GlmOcrExtractor()
	// if (config?.ocrProvider === "chandra") return new ChandraExtractor()

	// Default: MarkItDown handles everything
	const { MarkItDownExtractor } = await import("./markitdown.js")
	return new MarkItDownExtractor()
}
