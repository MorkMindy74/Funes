import DOMPurify from "dompurify"

/**
 * Sanitize HTML content to prevent XSS attacks.
 * Uses DOMPurify to strip dangerous elements and attributes.
 */
export function sanitizeHTML(dirty: string): string {
	return DOMPurify.sanitize(dirty, {
		ALLOWED_TAGS: ["div", "span", "br", "b", "i", "em", "strong"],
		ALLOWED_ATTR: [],
	})
}

/**
 * Escape a string for safe use in dataset attributes that may later be used in innerHTML.
 */
export function escapeForDataAttr(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;")
}
