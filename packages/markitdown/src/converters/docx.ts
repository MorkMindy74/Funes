import {
	DocumentConverter,
	DocumentConverterResult,
} from "../base-converter.js"
import * as mammoth from "mammoth"
import { htmlToMarkdown } from "../markdown.js"
import type { ConvertOptions } from "../types.js"

const ACCEPTED_MIME_TYPE_PREFIXES = [
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]
const ACCEPTED_FILE_EXTENSIONS = [".docx"]

export class DocxConverter extends DocumentConverter {
	accepts({
		streamInfo,
	}: Parameters<DocumentConverter["accepts"]>[0]): boolean {
		const mimetype = streamInfo.mimetype?.toLowerCase() ?? ""
		const extension = streamInfo.extension?.toLowerCase() ?? ""
		return (
			ACCEPTED_FILE_EXTENSIONS.includes(extension) ||
			ACCEPTED_MIME_TYPE_PREFIXES.some((prefix) => mimetype.startsWith(prefix))
		)
	}

	async convert(
		{ buffer }: Parameters<DocumentConverter["convert"]>[0],
		options: ConvertOptions,
	): Promise<DocumentConverterResult> {
		const result = await mammoth.convertToHtml(
			{ buffer },
			{
				styleMap: normalizeStyleMap(options.styleMap),
			},
		)
		const markdown = htmlToMarkdown(result.value, options).markdown
		return new DocumentConverterResult(markdown.trim())
	}
}

function normalizeStyleMap(
	styleMap: ConvertOptions["styleMap"],
): string[] | undefined {
	if (!styleMap) {
		return undefined
	}
	return Array.isArray(styleMap) ? styleMap : [styleMap]
}
