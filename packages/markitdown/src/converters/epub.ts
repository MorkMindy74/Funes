import path from "node:path"
import JSZip from "jszip"
import { XMLParser } from "fast-xml-parser"
import {
	DocumentConverter,
	DocumentConverterResult,
} from "../base-converter.js"
import { htmlToMarkdown } from "../markdown.js"
import type { ConvertOptions } from "../types.js"

const ACCEPTED_MIME_TYPE_PREFIXES = [
	"application/epub",
	"application/epub+zip",
	"application/x-epub+zip",
]
const ACCEPTED_FILE_EXTENSIONS = [".epub"]

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	trimValues: true,
})

export class EpubConverter extends DocumentConverter {
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
		const zip = await JSZip.loadAsync(buffer)
		const containerXml = await zip
			.file("META-INF/container.xml")
			?.async("string")
		if (!containerXml) {
			throw new TypeError("Invalid EPUB: missing META-INF/container.xml")
		}

		const container = parser.parse(containerXml)
		const rootfile = container?.container?.rootfiles?.rootfile
		const opfPath =
			typeof rootfile?.["full-path"] === "string"
				? rootfile["full-path"]
				: undefined
		if (!opfPath) {
			throw new TypeError("Invalid EPUB: missing package rootfile.")
		}

		const opfXml = await zip.file(opfPath)?.async("string")
		if (!opfXml) {
			throw new TypeError("Invalid EPUB: missing OPF package document.")
		}

		const opf = parser.parse(opfXml)?.package
		const metadata = opf?.metadata ?? {}
		const manifestItems = arrayify(opf?.manifest?.item)
		const manifest = new Map(
			manifestItems.map((item) => [String(item.id), String(item.href)]),
		)

		const spineItems = arrayify(opf?.spine?.itemref)
		const basePath = path.posix.dirname(opfPath)
		const sections: string[] = []

		const metadataLines = [
			formatMetadata("Title", textNode(metadata?.["dc:title"])),
			formatMetadata(
				"Authors",
				arrayify(metadata?.["dc:creator"])
					.map(textNode)
					.filter(Boolean)
					.join(", "),
			),
			formatMetadata("Language", textNode(metadata?.["dc:language"])),
			formatMetadata("Publisher", textNode(metadata?.["dc:publisher"])),
			formatMetadata("Date", textNode(metadata?.["dc:date"])),
			formatMetadata("Description", textNode(metadata?.["dc:description"])),
			formatMetadata("Identifier", textNode(metadata?.["dc:identifier"])),
		].filter(Boolean)

		if (metadataLines.length > 0) {
			sections.push(metadataLines.join("\n"))
		}

		for (const itemRef of spineItems) {
			const href = manifest.get(String(itemRef.idref))
			if (!href) {
				continue
			}

			const filePath = basePath === "." ? href : path.posix.join(basePath, href)
			const file = zip.file(filePath)
			if (!file) {
				continue
			}

			const html = await file.async("string")
			const markdown = htmlToMarkdown(html, options).markdown
			if (markdown) {
				sections.push(markdown)
			}
		}

		return new DocumentConverterResult(
			sections.join("\n\n").trim(),
			textNode(metadata?.["dc:title"]) ?? undefined,
		)
	}
}

function formatMetadata(key: string, value?: string): string | undefined {
	return value ? `**${key}:** ${value}` : undefined
}

function arrayify<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) {
		return []
	}
	return Array.isArray(value) ? value : [value]
}

function textNode(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value.trim()
	}
	if (value && typeof value === "object" && "#text" in value) {
		const text = (value as { "#text"?: unknown })["#text"]
		if (typeof text === "string") {
			return text.trim()
		}
	}
	return undefined
}
