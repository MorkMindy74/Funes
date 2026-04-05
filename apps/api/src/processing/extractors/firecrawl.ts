/**
 * Firecrawl Extractor — Web scraping with JS rendering.
 *
 * Uses the self-hosted Firecrawl API for:
 * - JavaScript-rendered pages (SPAs, dynamic content)
 * - Boilerplate removal (navigation, footer, ads)
 * - Clean markdown extraction
 *
 * Requires: FIRECRAWL_URL environment variable pointing to a running Firecrawl instance.
 * Start with: docker compose --profile with-firecrawl up
 *
 * Falls back to MarkItDown if Firecrawl fails.
 */

import type { Extractor, ExtractResult } from "./index.js"
import { logger } from "../../logger.js"

export class FirecrawlExtractor implements Extractor {
	name = "firecrawl"
	private baseUrl: string

	constructor(firecrawlUrl: string) {
		this.baseUrl = firecrawlUrl.replace(/\/$/, "")
	}

	async extract(
		input: string | Buffer,
		_options?: { filename?: string; mimeType?: string },
	): Promise<ExtractResult> {
		// Firecrawl only handles URLs — for non-URLs, delegate to MarkItDown
		if (typeof input !== "string" || !isUrl(input)) {
			const { MarkItDownExtractor } = await import("./markitdown.js")
			return new MarkItDownExtractor().extract(input, _options)
		}

		const url = input
		logger.info({ url }, "FirecrawlExtractor: scraping URL")

		try {
			const result = await this.scrapeUrl(url)
			return result
		} catch (error) {
			// Fallback to MarkItDown on Firecrawl failure
			logger.warn(
				{ url, error: error instanceof Error ? error.message : error },
				"FirecrawlExtractor: failed, falling back to MarkItDown",
			)
			const { MarkItDownExtractor } = await import("./markitdown.js")
			return new MarkItDownExtractor().extract(input, _options)
		}
	}

	private async scrapeUrl(url: string): Promise<ExtractResult> {
		const response = await fetch(`${this.baseUrl}/v1/scrape`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url,
				formats: ["markdown"],
				waitFor: 2000, // Wait 2s for JS rendering
				timeout: 30000,
				removeBase64Images: true,
				blockAds: true,
			}),
			signal: AbortSignal.timeout(60000),
		})

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error")
			throw new Error(`Firecrawl scrape failed (${response.status}): ${errorText}`)
		}

		const data = (await response.json()) as {
			success: boolean
			data?: {
				markdown?: string
				metadata?: {
					title?: string
					description?: string
					sourceURL?: string
					ogTitle?: string
				}
			}
			error?: string
		}

		if (!data.success || !data.data?.markdown) {
			throw new Error(data.error || "Firecrawl returned empty result")
		}

		const title =
			data.data.metadata?.title ||
			data.data.metadata?.ogTitle ||
			undefined

		logger.info(
			{ url, chars: data.data.markdown.length, title },
			"FirecrawlExtractor: scraped successfully",
		)

		return {
			markdown: data.data.markdown,
			title,
			sourceType: "url",
		}
	}
}

/**
 * Batch scrape multiple URLs via Firecrawl's crawl API.
 * Useful for importing entire sites or sitemaps.
 */
export async function batchScrape(
	firecrawlUrl: string,
	urls: string[],
	options?: { maxPages?: number },
): Promise<Array<{ url: string; result: ExtractResult | null; error?: string }>> {
	const extractor = new FirecrawlExtractor(firecrawlUrl)
	const results: Array<{ url: string; result: ExtractResult | null; error?: string }> = []

	// Process sequentially to avoid overwhelming Firecrawl
	for (const url of urls.slice(0, options?.maxPages ?? 50)) {
		try {
			const result = await extractor.extract(url)
			results.push({ url, result })
		} catch (error) {
			results.push({
				url,
				result: null,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	return results
}

/** Check if input looks like a URL */
function isUrl(input: string): boolean {
	return /^https?:\/\//i.test(input.trim())
}

/** Check if Firecrawl service is reachable */
export async function isFirecrawlAvailable(firecrawlUrl: string): Promise<boolean> {
	try {
		const response = await fetch(`${firecrawlUrl}/v1/scrape`, {
			method: "OPTIONS",
			signal: AbortSignal.timeout(3000),
		}).catch(() => null)

		// Also try a simple GET
		if (!response?.ok) {
			const healthResp = await fetch(firecrawlUrl, {
				signal: AbortSignal.timeout(3000),
			}).catch(() => null)
			return !!healthResp?.ok
		}

		return true
	} catch {
		return false
	}
}
