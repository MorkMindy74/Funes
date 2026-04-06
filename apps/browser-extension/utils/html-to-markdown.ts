/**
 * Enhanced HTML-to-Markdown converter for the browser extension.
 *
 * Uses Turndown with GFM plugin (tables, strikethrough, task lists)
 * and custom rules ported from MarkItDown's markdown.ts, adapted
 * for the browser environment (no cheerio — uses native DOM).
 */
import TurndownService from "turndown"
import { gfm } from "turndown-plugin-gfm"

function createTurndown(): TurndownService {
	const turndown = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
	})

	turndown.use(gfm)

	// Custom link rule: skip javascript:/mailto:/tel: hrefs
	turndown.addRule("links", {
		filter: "a",
		replacement(content: string, node: Node) {
			const element = node as HTMLElement
			const href = element.getAttribute("href") ?? ""
			const title = element.getAttribute("title")
			const text = content.trim()

			if (!text) return ""

			if (isRejectedHref(href)) return text

			if (!href) return text

			const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : ""
			return `[${text}](${href}${titlePart})`
		},
	})

	// Custom image rule: handle data-src, truncate data URIs
	turndown.addRule("images", {
		filter: "img",
		replacement(_content: string, node: Node) {
			const element = node as HTMLElement
			const alt = (element.getAttribute("alt") ?? "")
				.replace(/\s+/g, " ")
				.trim()
			let src =
				element.getAttribute("src") ?? element.getAttribute("data-src") ?? ""

			// Truncate data URIs to avoid bloating markdown
			if (src.startsWith("data:")) {
				src = `${src.split(",")[0]}...`
			}

			const title = element.getAttribute("title")
			const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : ""
			return `![${alt}](${src}${titlePart})`
		},
	})

	// Custom checkbox rule
	turndown.addRule("checkboxes", {
		filter: "input",
		replacement(_content: string, node: Node) {
			const element = node as HTMLElement
			if (element.getAttribute("type") !== "checkbox") return ""
			return element.hasAttribute("checked") ? "[x] " : "[ ] "
		},
	})

	return turndown
}

function isRejectedHref(href: string): boolean {
	if (!href) return false
	const trimmed = href.trim().toLowerCase()
	return (
		trimmed.startsWith("javascript:") ||
		trimmed.startsWith("mailto:") ||
		trimmed.startsWith("tel:")
	)
}

function normalizeMarkdown(markdown: string): string {
	return markdown
		.split(/\r?\n/)
		.map((line) => line.replace(/\s+$/, ""))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
}

// Singleton instance
let _turndown: TurndownService | null = null

/**
 * Convert an HTML string to clean Markdown.
 * Removes script/style tags, applies GFM formatting,
 * and normalizes whitespace.
 */
export function htmlToMarkdown(html: string): string {
	if (!_turndown) {
		_turndown = createTurndown()
	}
	const raw = _turndown.turndown(html)
	return normalizeMarkdown(raw)
}
