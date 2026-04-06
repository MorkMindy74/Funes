import {
	DocumentConverter,
	DocumentConverterResult,
} from "../base-converter.js"
import { decodeBuffer } from "../utils/stream.js"
import { FileConversionError } from "../errors.js"
import type { ConvertOptions } from "../types.js"

const CANDIDATE_MIME_TYPE_PREFIXES = ["application/json"]
const ACCEPTED_FILE_EXTENSIONS = [".ipynb"]

export class IpynbConverter extends DocumentConverter {
	accepts({
		buffer,
		streamInfo,
	}: Parameters<DocumentConverter["accepts"]>[0]): boolean {
		const mimetype = streamInfo.mimetype?.toLowerCase() ?? ""
		const extension = streamInfo.extension?.toLowerCase() ?? ""
		if (ACCEPTED_FILE_EXTENSIONS.includes(extension)) {
			return true
		}

		if (
			CANDIDATE_MIME_TYPE_PREFIXES.some((prefix) => mimetype.startsWith(prefix))
		) {
			const content = decodeBuffer(buffer, streamInfo.charset)
			return (
				content.includes('"nbformat"') && content.includes('"nbformat_minor"')
			)
		}

		return false
	}

	convert(
		{ buffer, streamInfo }: Parameters<DocumentConverter["convert"]>[0],
		_options: ConvertOptions,
	): DocumentConverterResult {
		try {
			const notebook = JSON.parse(decodeBuffer(buffer, streamInfo.charset)) as {
				cells?: Array<{ cell_type?: string; source?: string[] }>
				metadata?: { title?: string }
			}

			const parts: string[] = []
			let title = notebook.metadata?.title
			for (const cell of notebook.cells ?? []) {
				const source = (cell.source ?? []).join("")
				switch (cell.cell_type) {
					case "markdown":
						parts.push(source)
						if (!title) {
							const match = /^#\s+(.+)$/m.exec(source)
							if (match) {
								title = match[1].trim()
							}
						}
						break
					case "code":
						parts.push(`\`\`\`python\n${source}\n\`\`\``)
						break
					case "raw":
						parts.push(`\`\`\`\n${source}\n\`\`\``)
						break
					default:
						break
				}
			}

			return new DocumentConverterResult(parts.join("\n\n").trim(), title)
		} catch (error) {
			throw new FileConversionError(
				error instanceof Error
					? error.message
					: "Error converting .ipynb file.",
			)
		}
	}
}
