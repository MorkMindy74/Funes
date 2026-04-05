import { MarkItDown } from "@repo/markitdown"

export interface ExaContentResult {
	url: string
	text: string
	title: string
	author?: string
}

interface ExaApiResponse {
	results: ExaContentResult[]
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
 * Fallback: convert a single URL to text using MarkItDown.
 */
async function convertWithMarkItDown(
	url: string,
): Promise<ExaContentResult | null> {
	try {
		const result = await getMarkItDown().convert(url)
		return {
			url,
			text: result.textContent,
			title: result.title || "",
		}
	} catch (error) {
		console.error(`MarkItDown fallback failed for ${url}:`, error)
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

		const exaApiKey = process.env.EXA_API_KEY

		// If Exa API key is available, try Exa first
		if (exaApiKey?.trim()) {
			try {
				const response = await fetch("https://api.exa.ai/contents", {
					method: "POST",
					headers: {
						"x-api-key": exaApiKey,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						urls,
						text: true,
						livecrawl: "fallback",
					}),
				})

				if (response.ok) {
					const data: ExaApiResponse = await response.json()
					return Response.json({ results: data.results })
				}

				console.warn(
					"Exa API request failed, falling back to MarkItDown:",
					response.status,
					response.statusText,
				)
			} catch (error) {
				console.warn(
					"Exa API request error, falling back to MarkItDown:",
					error,
				)
			}
		} else {
			console.info(
				"EXA_API_KEY not configured, using MarkItDown for content extraction",
			)
		}

		// Fallback: use MarkItDown for each URL
		const results = await Promise.all(
			urls.map((url: string) => convertWithMarkItDown(url)),
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
