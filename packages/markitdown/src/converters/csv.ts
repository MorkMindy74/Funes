import {
	DocumentConverter,
	DocumentConverterResult,
} from "../base-converter.js"
import { decodeBuffer } from "../utils/stream.js"
import type { ConvertOptions } from "../types.js"

const ACCEPTED_MIME_TYPE_PREFIXES = ["text/csv", "application/csv"]
const ACCEPTED_FILE_EXTENSIONS = [".csv"]

export class CsvConverter extends DocumentConverter {
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

	convert(
		{ buffer, streamInfo }: Parameters<DocumentConverter["convert"]>[0],
		_options: ConvertOptions,
	): DocumentConverterResult {
		const rows = parseCsv(decodeBuffer(buffer, streamInfo.charset))
		if (rows.length === 0) {
			return new DocumentConverterResult("")
		}

		const width = rows[0].length
		const normalized = rows.map((row) =>
			[...row, ...Array(Math.max(0, width - row.length)).fill("")].slice(
				0,
				width,
			),
		)
		const lines = [
			`| ${normalized[0].join(" | ")} |`,
			`| ${Array(width).fill("---").join(" | ")} |`,
			...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
		]

		return new DocumentConverterResult(lines.join("\n"))
	}
}

function parseCsv(input: string): string[][] {
	const rows: string[][] = []
	let row: string[] = []
	let field = ""
	let quoted = false

	for (let index = 0; index < input.length; index += 1) {
		const char = input[index]
		const next = input[index + 1]

		if (quoted) {
			if (char === '"' && next === '"') {
				field += '"'
				index += 1
			} else if (char === '"') {
				quoted = false
			} else {
				field += char
			}
			continue
		}

		if (char === '"') {
			quoted = true
		} else if (char === ",") {
			row.push(field)
			field = ""
		} else if (char === "\n") {
			row.push(field.replace(/\r$/, ""))
			rows.push(row)
			row = []
			field = ""
		} else {
			field += char
		}
	}

	if (field.length > 0 || row.length > 0) {
		row.push(field.replace(/\r$/, ""))
		rows.push(row)
	}

	return rows
}
