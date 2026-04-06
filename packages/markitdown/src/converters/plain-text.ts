import {
	DocumentConverter,
	DocumentConverterResult,
} from "../base-converter.js"
import { decodeBuffer } from "../utils/stream.js"
import type { ConvertOptions } from "../types.js"

const ACCEPTED_MIME_TYPE_PREFIXES = [
	"text/",
	"application/json",
	"application/markdown",
]
const ACCEPTED_FILE_EXTENSIONS = [
	".txt",
	".text",
	".md",
	".markdown",
	".json",
	".jsonl",
]

export class PlainTextConverter extends DocumentConverter {
	accepts({
		streamInfo,
	}: Parameters<DocumentConverter["accepts"]>[0]): boolean {
		const mimetype = streamInfo.mimetype?.toLowerCase() ?? ""
		const extension = streamInfo.extension?.toLowerCase() ?? ""

		if (streamInfo.charset) {
			return true
		}

		return (
			ACCEPTED_FILE_EXTENSIONS.includes(extension) ||
			ACCEPTED_MIME_TYPE_PREFIXES.some((prefix) => mimetype.startsWith(prefix))
		)
	}

	convert(
		{ buffer, streamInfo }: Parameters<DocumentConverter["convert"]>[0],
		_options: ConvertOptions,
	): DocumentConverterResult {
		return new DocumentConverterResult(decodeBuffer(buffer, streamInfo.charset))
	}
}
