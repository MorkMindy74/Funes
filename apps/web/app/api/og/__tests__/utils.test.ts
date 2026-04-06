import { describe, it, expect } from "vitest"
import {
	isValidUrl,
	isPrivateHost,
	isNonHtmlUrl,
	extractMetaTag,
	resolveImageUrl,
	extractImageUrl,
} from "../utils"

describe("isValidUrl", () => {
	it("accepts http URLs", () => {
		expect(isValidUrl("http://example.com")).toBe(true)
	})

	it("accepts https URLs", () => {
		expect(isValidUrl("https://example.com")).toBe(true)
	})

	it("rejects ftp URLs", () => {
		expect(isValidUrl("ftp://example.com")).toBe(false)
	})

	it("rejects javascript URLs", () => {
		expect(isValidUrl("javascript:alert(1)")).toBe(false)
	})

	it("rejects invalid strings", () => {
		expect(isValidUrl("not-a-url")).toBe(false)
		expect(isValidUrl("")).toBe(false)
	})
})

describe("isPrivateHost", () => {
	it("detects localhost", () => {
		expect(isPrivateHost("localhost")).toBe(true)
		expect(isPrivateHost("127.0.0.1")).toBe(true)
		expect(isPrivateHost("::1")).toBe(true)
	})

	it("detects 10.x.x.x range", () => {
		expect(isPrivateHost("10.0.0.1")).toBe(true)
		expect(isPrivateHost("10.255.255.255")).toBe(true)
	})

	it("detects 172.16-31.x.x range", () => {
		expect(isPrivateHost("172.16.0.1")).toBe(true)
		expect(isPrivateHost("172.31.255.255")).toBe(true)
	})

	it("rejects 172.32.x.x (outside range)", () => {
		expect(isPrivateHost("172.32.0.1")).toBe(false)
	})

	it("detects 192.168.x.x range", () => {
		expect(isPrivateHost("192.168.0.1")).toBe(true)
		expect(isPrivateHost("192.168.1.1")).toBe(true)
	})

	it("allows public IPs", () => {
		expect(isPrivateHost("8.8.8.8")).toBe(false)
		expect(isPrivateHost("example.com")).toBe(false)
	})

	it("detects 0.0.0.0", () => {
		expect(isPrivateHost("0.0.0.0")).toBe(true)
	})
})

describe("isNonHtmlUrl", () => {
	it("detects PDF URLs", () => {
		expect(isNonHtmlUrl("https://example.com/doc.pdf")).toBe(true)
	})

	it("detects image URLs", () => {
		expect(isNonHtmlUrl("https://example.com/image.jpg")).toBe(true)
		expect(isNonHtmlUrl("https://example.com/image.png")).toBe(true)
		expect(isNonHtmlUrl("https://example.com/image.gif")).toBe(true)
	})

	it("allows HTML URLs", () => {
		expect(isNonHtmlUrl("https://example.com/page")).toBe(false)
		expect(isNonHtmlUrl("https://example.com/page.html")).toBe(false)
		expect(isNonHtmlUrl("https://example.com/")).toBe(false)
	})

	it("handles invalid URLs gracefully", () => {
		expect(isNonHtmlUrl("not-a-url")).toBe(false)
	})
})

describe("extractMetaTag", () => {
	it("extracts OG title", () => {
		const html = '<meta property="og:title" content="Test Title">'
		const patterns = [
			/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
		]
		expect(extractMetaTag(html, patterns)).toBe("Test Title")
	})

	it("decodes HTML entities", () => {
		const html = '<meta property="og:title" content="Test &amp; Title">'
		const patterns = [
			/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
		]
		expect(extractMetaTag(html, patterns)).toBe("Test & Title")
	})

	it("returns empty string when no match", () => {
		const html = "<html><body>No meta tags</body></html>"
		const patterns = [
			/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
		]
		expect(extractMetaTag(html, patterns)).toBe("")
	})

	it("tries multiple patterns in order", () => {
		const html = "<title>Fallback Title</title>"
		const patterns = [
			/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
			/<title>([^<]+)<\/title>/i,
		]
		expect(extractMetaTag(html, patterns)).toBe("Fallback Title")
	})
})

describe("resolveImageUrl", () => {
	it("returns absolute URLs unchanged", () => {
		expect(
			resolveImageUrl("https://example.com/image.jpg", "https://base.com"),
		).toBe("https://example.com/image.jpg")
	})

	it("resolves relative URLs against base", () => {
		expect(resolveImageUrl("/image.jpg", "https://example.com/page")).toBe(
			"https://example.com/image.jpg",
		)
	})

	it("returns undefined for undefined input", () => {
		expect(resolveImageUrl(undefined, "https://example.com")).toBeUndefined()
	})

	it("returns undefined for completely invalid URLs", () => {
		expect(resolveImageUrl(":::invalid", ":::invalid")).toBeUndefined()
	})
})

describe("extractImageUrl", () => {
	it("returns string directly", () => {
		expect(extractImageUrl("https://example.com/img.jpg")).toBe(
			"https://example.com/img.jpg",
		)
	})

	it("extracts URL from array of objects", () => {
		expect(extractImageUrl([{ url: "https://example.com/img.jpg" }])).toBe(
			"https://example.com/img.jpg",
		)
	})

	it("returns undefined for null/undefined", () => {
		expect(extractImageUrl(null)).toBeUndefined()
		expect(extractImageUrl(undefined)).toBeUndefined()
	})

	it("returns empty string for empty array", () => {
		expect(extractImageUrl([])).toBe("")
	})
})
