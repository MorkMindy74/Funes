/**
 * Document type detection utility.
 * Maps file extensions and MIME types to Funes DocumentType values.
 */

const EXTENSION_MAP: Record<string, string> = {
	".pdf": "pdf",
	".docx": "docx",
	".doc": "docx",
	".xlsx": "xlsx",
	".xls": "xlsx",
	".pptx": "pptx",
	".ppt": "pptx",
	".epub": "epub",
	".csv": "csv",
	".ipynb": "jupyter",
	".msg": "outlook_msg",
	".html": "webpage",
	".htm": "webpage",
	".rss": "rss",
	".atom": "rss",
	".xml": "rss",
	".txt": "text",
	".md": "text",
	".markdown": "text",
	".json": "text",
	".jpg": "image",
	".jpeg": "image",
	".png": "image",
	".gif": "image",
	".webp": "image",
	".svg": "image",
	".mp4": "video",
	".webm": "video",
	".mov": "video",
};

const MIME_MAP: Record<string, string> = {
	"application/pdf": "pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
	"application/msword": "docx",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
	"application/vnd.ms-excel": "xlsx",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
	"application/vnd.ms-powerpoint": "pptx",
	"application/epub+zip": "epub",
	"text/csv": "csv",
	"application/vnd.ms-outlook": "outlook_msg",
	"text/html": "webpage",
	"application/xhtml+xml": "webpage",
	"application/rss+xml": "rss",
	"application/atom+xml": "rss",
	"text/plain": "text",
	"text/markdown": "text",
	"application/json": "text",
	"image/jpeg": "image",
	"image/png": "image",
	"image/gif": "image",
	"image/webp": "image",
	"video/mp4": "video",
	"video/webm": "video",
};

/**
 * Detect the Funes document type from a filename and/or MIME type.
 * Returns "text" as fallback if no match is found.
 */
export function detectDocumentType(
	filename?: string,
	mimeType?: string,
): string {
	// Try extension first (more specific)
	if (filename) {
		const dot = filename.lastIndexOf(".");
		if (dot > 0) {
			const ext = filename.slice(dot).toLowerCase();
			const type = EXTENSION_MAP[ext];
			if (type) return type;
		}
	}

	// Try MIME type
	if (mimeType) {
		const normalized = mimeType.split(";")[0]?.trim().toLowerCase();
		if (normalized) {
			const type = MIME_MAP[normalized];
			if (type) return type;

			// Generic MIME fallbacks
			if (normalized.startsWith("image/")) return "image";
			if (normalized.startsWith("video/")) return "video";
			if (normalized.startsWith("text/")) return "text";
		}
	}

	return "text";
}
