import { checkRateLimit } from "./rate-limit"
import {
	isValidUrl,
	isPrivateHost,
	isNonHtmlUrl,
	extractMetaTag,
	resolveImageUrl,
} from "./utils"

interface OGResponse {
	title: string
	description: string
	image?: string
}

export async function GET(request: Request) {
	try {
		const clientIp =
			request.headers.get("cf-connecting-ip") ||
			request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
			"unknown"
		const { allowed, retryAfter } = checkRateLimit(clientIp)
		if (!allowed) {
			return Response.json(
				{ error: "Too many requests" },
				{
					status: 429,
					headers: { "Retry-After": retryAfter.toString() },
				},
			)
		}

		const { searchParams } = new URL(request.url)
		const url = searchParams.get("url")

		if (!url || !url.trim()) {
			return Response.json(
				{ error: "Missing or invalid url parameter" },
				{ status: 400 },
			)
		}

		const trimmedUrl = url.trim()

		if (!isValidUrl(trimmedUrl)) {
			return Response.json(
				{ error: "Invalid URL. Must be http:// or https://" },
				{ status: 400 },
			)
		}

		const urlObj = new URL(trimmedUrl)
		if (isPrivateHost(urlObj.hostname)) {
			return Response.json(
				{ error: "Private/localhost URLs are not allowed" },
				{ status: 400 },
			)
		}

		// Skip OG scraping for non-HTML files (PDFs, images, etc.)
		if (isNonHtmlUrl(trimmedUrl)) {
			return Response.json(
				{ title: "", description: "" },
				{
					headers: {
						"Cache-Control":
							"public, s-maxage=3600, stale-while-revalidate=86400",
					},
				},
			)
		}

		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), 8000)

		const response = await fetch(trimmedUrl, {
			signal: controller.signal,
			headers: {
				"User-Agent":
					"Mozilla/5.0 (compatible; SuperMemory/1.0; +https://supermemory.ai)",
			},
		})

		clearTimeout(timeoutId)

		if (!response.ok) {
			return Response.json(
				{ error: "Failed to fetch URL" },
				{ status: response.status },
			)
		}

		const html = await response.text()

		const titlePatterns = [
			/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
			/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i,
			/<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i,
			/<title>([^<]+)<\/title>/i,
		]

		const descriptionPatterns = [
			/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i,
			/<meta\s+content=["']([^"']+)["']\s+property=["']og:description["']/i,
			/<meta\s+name=["']twitter:description["']\s+content=["']([^"']+)["']/i,
			/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
		]

		const imagePatterns = [
			/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
			/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i,
			/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i,
		]

		const title = extractMetaTag(html, titlePatterns)
		const description = extractMetaTag(html, descriptionPatterns)
		const imageUrl = extractMetaTag(html, imagePatterns)
		const resolvedImageUrl = resolveImageUrl(imageUrl, trimmedUrl)

		const ogResponse: OGResponse = {
			title,
			description,
			...(resolvedImageUrl && { image: resolvedImageUrl }),
		}

		return Response.json(ogResponse, {
			headers: {
				"Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
			},
		})
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			return Response.json({ error: "Request timeout" }, { status: 504 })
		}
		console.error("OG route error:", error)
		return Response.json({ error: "Internal server error" }, { status: 500 })
	}
}
