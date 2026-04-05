import { MarkItDown } from "@repo/markitdown"

export interface ExaContentResult {
	url: string
	text: string
	title: string
	author?: string
}

let _markitdown: MarkItDown | null = null

function getMarkItDown(): MarkItDown {
	if (!_markitdown) {
		_markitdown = new MarkItDown({
			pythonFallback: false,
			enableBuiltins: true,
		})
	}
	return _markitdown
}

/**
 * Convert a single URL to markdown using MarkItDown (local, free, no external API).
 */
async function convertUrl(url: string): Promise<ExaContentResult | null> {
	try {
		const result = await getMarkItDown().convert(url)
		return {
			url,
			text: result.textContent,
			title: result.title || "",
		}
	} catch (error) {
		console.error(`MarkItDown conversion failed for ${url}:`, error)
		return null
	}
}

export async function POST(request: Request) {
	try {
		const { urls } = await request.json()

		if (!Array.isArray(urls) || urls.length === 0) {
			return Response.json(
				{ error: "Invalid input: urls must be a non-empty array" },
				{ status: 400 },
			)
		}

		if (!urls.every((url) => typeof url === "string" && url.trim())) {
			return Response.json(
				{ error: "Invalid input: all urls must be non-empty strings" },
				{ status: 400 },
			)
		}

		const results = await Promise.all(
			urls.map((url: string) => convertUrl(url)),
		)

		const validResults = results.filter(
			(r): r is ExaContentResult => r !== null,
		)

		if (validResults.length === 0) {
			return Response.json(
				{ error: "Failed to extract content from any of the provided URLs" },
				{ status: 500 },
			)
		}

		return Response.json({ results: validResults })
	} catch (error) {
		console.error("Extract content API error:", error)
		return Response.json({ error: "Internal server error" }, { status: 500 })
	}
}
