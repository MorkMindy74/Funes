/** Result of content extraction */
export interface ExtractResult {
	markdown: string
	title?: string
	sourceType?: string
}

/** Common interface for all extractors */
export interface Extractor {
	name: string
	extract(
		input: string | Buffer,
		options?: { filename?: string; mimeType?: string },
	): Promise<ExtractResult>
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
 *   2. OCR (Ollama Vision) — for images/scanned docs, when OCR_PROVIDER = "ollama-ocr"
 *   3. OCR (Chandra) — for images/scanned docs, when OCR_PROVIDER = "chandra"
 *   4. MarkItDown — default fallback (handles URL, HTML, PDF, DOCX, etc.)
 *
 * When both Firecrawl and OCR are configured, the returned extractor delegates
 * based on content type: URLs → Firecrawl, images → OCR, rest → MarkItDown.
 */
export async function getExtractor(
	_contentType?: string,
	config?: {
		firecrawlUrl?: string
		ocrProvider?: string
		chandraUrl?: string
		ollamaUrl?: string
	},
): Promise<Extractor> {
	// If OCR provider is set, return the appropriate OCR extractor
	// (each OCR extractor internally delegates non-image content to MarkItDown)
	if (config?.ocrProvider === "ollama-ocr" && config?.ollamaUrl) {
		const { OllamaOcrExtractor } = await import("./ollama-ocr.js")
		// Wrap with Firecrawl for URLs if both are configured
		if (config.firecrawlUrl) {
			return createCompositeExtractor(
				config.firecrawlUrl,
				new OllamaOcrExtractor(config.ollamaUrl),
			)
		}
		return new OllamaOcrExtractor(config.ollamaUrl)
	}

	if (config?.ocrProvider === "chandra" && config?.chandraUrl) {
		const { ChandraExtractor } = await import("./chandra.js")
		if (config.firecrawlUrl) {
			return createCompositeExtractor(
				config.firecrawlUrl,
				new ChandraExtractor(config.chandraUrl),
			)
		}
		return new ChandraExtractor(config.chandraUrl)
	}

	// Firecrawl for URL extraction (JS rendering, clean markdown)
	if (config?.firecrawlUrl) {
		const { FirecrawlExtractor } = await import("./firecrawl.js")
		return new FirecrawlExtractor(config.firecrawlUrl)
	}

	// Default: MarkItDown handles everything
	const { MarkItDownExtractor } = await import("./markitdown.js")
	return new MarkItDownExtractor()
}

/**
 * Composite extractor: routes URLs to Firecrawl, images to OCR, rest to MarkItDown.
 * Used when both Firecrawl AND an OCR provider are configured simultaneously.
 */
async function createCompositeExtractor(
	firecrawlUrl: string,
	ocrExtractor: Extractor,
): Promise<Extractor> {
	const { FirecrawlExtractor } = await import("./firecrawl.js")
	const firecrawl = new FirecrawlExtractor(firecrawlUrl)

	return {
		name: `composite(${firecrawl.name}+${ocrExtractor.name})`,
		async extract(
			input: string | Buffer,
			options?: { filename?: string; mimeType?: string },
		): Promise<ExtractResult> {
			// URLs → Firecrawl
			if (isUrl(input)) {
				return firecrawl.extract(input, options)
			}
			// Everything else (images, buffers, text) → OCR extractor
			// (OCR extractor internally delegates non-image to MarkItDown)
			return ocrExtractor.extract(input, options)
		},
	}
}
