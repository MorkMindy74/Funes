import { MarkItDown, StreamInfo, detectDocumentType } from "@repo/markitdown"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

// Rate limiting (reuse pattern from og/rate-limit)
const WINDOW_MS = 60_000
const MAX_REQUESTS = 20

interface RateLimitEntry {
	count: number
	resetAt: number
}

const ipRequests = new Map<string, RateLimitEntry>()

setInterval(() => {
	const now = Date.now()
	for (const [ip, entry] of ipRequests) {
		if (now > entry.resetAt) {
			ipRequests.delete(ip)
		}
	}
}, WINDOW_MS)

function checkRateLimit(ip: string): {
	allowed: boolean
	retryAfter: number
} {
	const now = Date.now()
	const entry = ipRequests.get(ip)

	if (!entry || now > entry.resetAt) {
		ipRequests.set(ip, { count: 1, resetAt: now + WINDOW_MS })
		return { allowed: true, retryAfter: 0 }
	}

	if (entry.count >= MAX_REQUESTS) {
		const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
		return { allowed: false, retryAfter }
	}

	entry.count++
	return { allowed: true, retryAfter: 0 }
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
 * POST /api/convert
 *
 * Converts a document to Markdown using MarkItDown.
 *
 * Accepts either:
 * - JSON body: { "url": "https://..." }
 * - multipart/form-data with a "file" field
 *
 * Returns: { markdown: string, title?: string, sourceType: string }
 */
export async function POST(request: Request) {
	try {
		// Rate limiting
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

		const contentType = request.headers.get("content-type") || ""
		const markitdown = getMarkItDown()

		// Handle multipart file upload
		if (contentType.includes("multipart/form-data")) {
			const formData = await request.formData()
			const file = formData.get("file")

			if (!file || !(file instanceof File)) {
				return Response.json(
					{ error: "Missing 'file' field in form data" },
					{ status: 400 },
				)
			}

			if (file.size > MAX_FILE_SIZE) {
				return Response.json(
					{
						error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
					},
					{ status: 413 },
				)
			}

			const buffer = Buffer.from(await file.arrayBuffer())
			const streamInfo = new StreamInfo({
				filename: file.name,
				mimetype: file.type || undefined,
				extension: extractExtension(file.name),
			})

			const result = await markitdown.convertBuffer(buffer, streamInfo)
			const sourceType = detectDocumentType(file.name, file.type)

			return Response.json({
				markdown: result.textContent,
				title: result.title,
				sourceType,
			})
		}

		// Handle JSON body with URL
		const body = await request.json()
		const { url } = body as { url?: string }

		if (!url?.trim()) {
			return Response.json(
				{ error: "Missing 'url' field or 'file' in form data" },
				{ status: 400 },
			)
		}

		const trimmedUrl = url.trim()

		if (!/^https?:\/\//i.test(trimmedUrl)) {
			return Response.json(
				{ error: "Invalid URL. Must be http:// or https://" },
				{ status: 400 },
			)
		}

		const result = await markitdown.convert(trimmedUrl)
		const sourceType = detectDocumentType(undefined, undefined)

		return Response.json(
			{
				markdown: result.textContent,
				title: result.title,
				sourceType: "webpage",
			},
			{
				headers: {
					"Cache-Control":
						"public, s-maxage=3600, stale-while-revalidate=86400",
				},
			},
		)
	} catch (error) {
		console.error("Convert API error:", error)
		const message =
			error instanceof Error ? error.message : "Internal server error"
		return Response.json({ error: message }, { status: 500 })
	}
}

function extractExtension(filename: string): string | undefined {
	const dot = filename.lastIndexOf(".")
	return dot > 0 ? filename.slice(dot) : undefined
}
