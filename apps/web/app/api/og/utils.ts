export function isValidUrl(urlString: string): boolean {
	try {
		const url = new URL(urlString)
		return url.protocol === "http:" || url.protocol === "https:"
	} catch {
		return false
	}
}

export function isPrivateHost(hostname: string): boolean {
	const lowerHost = hostname.toLowerCase()

	if (
		lowerHost === "localhost" ||
		lowerHost === "127.0.0.1" ||
		lowerHost === "::1" ||
		lowerHost.startsWith("127.") ||
		lowerHost.startsWith("0.0.0.0")
	) {
		return true
	}

	const privateIpPatterns = [
		/^10\./,
		/^172\.(1[6-9]|2[0-9]|3[01])\./,
		/^192\.168\./,
	]

	return privateIpPatterns.some((pattern) => pattern.test(hostname))
}

// File extensions that are not HTML and can't be scraped for OG data
export const NON_HTML_EXTENSIONS = [
	".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
	".zip", ".rar", ".7z", ".tar", ".gz",
	".mp3", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".wav", ".ogg",
	".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".bmp", ".tiff",
	".exe", ".dmg", ".iso", ".bin",
]

export function isNonHtmlUrl(url: string): boolean {
	try {
		const urlObj = new URL(url)
		const pathname = urlObj.pathname.toLowerCase()
		return NON_HTML_EXTENSIONS.some((ext) => pathname.endsWith(ext))
	} catch {
		return false
	}
}

export function extractImageUrl(image: unknown): string | undefined {
	if (!image) return undefined

	if (typeof image === "string") {
		return image
	}

	if (Array.isArray(image) && image.length > 0) {
		const first = image[0]
		if (first && typeof first === "object" && "url" in first) {
			return String(first.url)
		}
	}
	return ""
}

export function extractMetaTag(html: string, patterns: RegExp[]): string {
	for (const pattern of patterns) {
		const match = html.match(pattern)
		if (match?.[1]) {
			return match[1]
				.replace(/&amp;/g, "&")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.replace(/&quot;/g, '"')
				.replace(/&#039;/g, "'")
				.trim()
		}
	}
	return ""
}

export function resolveImageUrl(
	imageUrl: string | undefined,
	baseUrl: string,
): string | undefined {
	if (!imageUrl) return undefined

	try {
		const url = new URL(imageUrl)
		return url.href
	} catch {
		try {
			const base = new URL(baseUrl)
			return new URL(imageUrl, base.href).href
		} catch {
			return undefined
		}
	}
}
