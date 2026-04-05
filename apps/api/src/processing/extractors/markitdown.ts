import { MarkItDown } from "@repo/markitdown"
import type { Extractor, ExtractResult } from "./index.js"

let instance: MarkItDown | null = null

function getMarkItDown(): MarkItDown {
	if (!instance) {
		instance = new MarkItDown()
	}
	return instance
}

export class MarkItDownExtractor implements Extractor {
	name = "markitdown"

	async extract(
		input: string | Buffer,
		options?: { filename?: string; mimeType?: string },
	): Promise<ExtractResult> {
		const mid = getMarkItDown()

		if (typeof input === "string") {
			// Could be a URL or plain text
			if (input.startsWith("http://") || input.startsWith("https://")) {
				const result = await mid.convert(input)
				return {
					markdown: result.textContent,
					title: result.title ?? undefined,
					sourceType: "url",
				}
			}

			// Plain text — return as-is
			return {
				markdown: input,
				title: undefined,
				sourceType: "text",
			}
		}

		// Buffer — convert with optional filename hint
		const convertOptions: Record<string, unknown> = {}
		if (options?.filename) {
			convertOptions.fileExtension = `.${options.filename.split(".").pop()}`
		}
		const result = await mid.convert(input, convertOptions as any)

		return {
			markdown: result.textContent,
			title: result.title ?? undefined,
			sourceType: options?.mimeType ?? "file",
		}
	}
}
