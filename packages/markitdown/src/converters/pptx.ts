import path from "node:path"
import mime from "mime-types"
import JSZip from "jszip"
import { XMLParser } from "fast-xml-parser"
import {
	DocumentConverter,
	DocumentConverterResult,
} from "../base-converter.js"
import { llmCaption } from "../llm-caption.js"
import { StreamInfo } from "../stream-info.js"
import type { ConvertOptions } from "../types.js"
import {
	extractText,
	findChild,
	findChildren,
	getAttribute,
	localName,
	toArray,
} from "../utils/xml.js"

const ACCEPTED_MIME_TYPE_PREFIXES = [
	"application/vnd.openxmlformats-officedocument.presentationml",
]
const ACCEPTED_FILE_EXTENSIONS = [".pptx"]

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	trimValues: false,
})

type ShapeEntry = {
	type: string
	node: Record<string, unknown>
}

type SlideContext = {
	zip: JSZip
	slidePath: string
	relMap: Map<string, string>
	options: ConvertOptions
}

export class PptxConverter extends DocumentConverter {
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
		const slidePaths = Object.keys(zip.files)
			.filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
			.sort((left, right) => getSlideNumber(left) - getSlideNumber(right))

		const sections: string[] = []
		for (const [index, slidePath] of slidePaths.entries()) {
			const relPath = slidePath.replace("/slides/", "/slides/_rels/") + ".rels"
			const slideXml = await zip.file(slidePath)?.async("string")
			if (!slideXml) {
				continue
			}

			const relMap = await parseRelationships(zip, relPath, slidePath)
			const slide = parser.parse(slideXml)
			const slideNode = findChild<Record<string, unknown>>(slide, "sld")
			const cSld = findChild<Record<string, unknown>>(slideNode, "cSld")
			const spTree = findChild<Record<string, unknown>>(cSld, "spTree")
			if (!spTree) {
				continue
			}

			sections.push(`<!-- Slide number: ${index + 1} -->`)
			const context: SlideContext = { zip, slidePath, relMap, options }
			const lines = await processEntries(
				getShapeEntries(spTree).sort(compareShapeEntries),
				context,
			)
			if (lines.length > 0) {
				sections.push(lines.join("\n").trim())
			}
			sections.push("")
		}

		return new DocumentConverterResult(sections.join("\n").trim())
	}
}

async function processEntries(
	entries: ShapeEntry[],
	context: SlideContext,
): Promise<string[]> {
	const lines: string[] = []
	for (const entry of entries) {
		const chunk = await processEntry(entry, context)
		if (!chunk) {
			continue
		}

		if (Array.isArray(chunk)) {
			for (const line of chunk) {
				if (line.trim().length > 0) {
					lines.push(line)
				}
			}
		} else if (chunk.trim().length > 0) {
			lines.push(chunk)
		}
	}
	return lines
}

async function processEntry(
	entry: ShapeEntry,
	context: SlideContext,
): Promise<string | string[] | undefined> {
	switch (entry.type) {
		case "sp":
			return processTextShape(entry.node)
		case "pic":
			return await processPicture(entry.node, context)
		case "graphicFrame":
			return await processGraphicFrame(entry.node, context)
		case "grpSp":
			return await processEntries(
				getShapeEntries(entry.node).sort(compareShapeEntries),
				context,
			)
		default:
			return undefined
	}
}

function getShapeEntries(tree: Record<string, unknown>): ShapeEntry[] {
	const entries: ShapeEntry[] = []
	for (const [key, value] of Object.entries(tree)) {
		const type = localName(key)
		if (!["sp", "pic", "graphicFrame", "grpSp"].includes(type)) {
			continue
		}

		for (const node of toArray(
			value as Record<string, unknown> | Record<string, unknown>[],
		)) {
			entries.push({ type, node })
		}
	}
	return entries
}

function compareShapeEntries(left: ShapeEntry, right: ShapeEntry): number {
	const leftPos = getShapePosition(left.node)
	const rightPos = getShapePosition(right.node)
	return leftPos.y - rightPos.y || leftPos.x - rightPos.x
}

function getShapePosition(node: Record<string, unknown>): {
	x: number
	y: number
} {
	const xfrm =
		findChild<Record<string, unknown>>(node, "xfrm") ??
		findChild<Record<string, unknown>>(findChild(node, "spPr"), "xfrm") ??
		findChild<Record<string, unknown>>(findChild(node, "grpSpPr"), "xfrm")
	const off = findChild<Record<string, unknown>>(xfrm, "off")
	const x = Number(getAttribute(off, "x") ?? 0)
	const y = Number(getAttribute(off, "y") ?? 0)
	return { x, y }
}

function processTextShape(node: Record<string, unknown>): string | undefined {
	const txBody = findChild<Record<string, unknown>>(node, "txBody")
	if (!txBody) {
		return undefined
	}

	const text = toArray(findChild(txBody, "p"))
		.map((paragraph) => extractText(paragraph).trim())
		.filter(Boolean)
		.join("\n")

	if (!text) {
		return undefined
	}

	return isTitleShape(node) ? `# ${text.trimStart()}` : text
}

function isTitleShape(node: Record<string, unknown>): boolean {
	const nvSpPr = findChild<Record<string, unknown>>(node, "nvSpPr")
	const nvPr = findChild<Record<string, unknown>>(nvSpPr, "nvPr")
	const ph = findChild<Record<string, unknown>>(nvPr, "ph")
	const type = String(getAttribute(ph, "type") ?? "")
	return type === "title" || type === "ctrTitle"
}

async function processPicture(
	node: Record<string, unknown>,
	context: SlideContext,
): Promise<string | undefined> {
	const nvPicPr = findChild<Record<string, unknown>>(node, "nvPicPr")
	const cNvPr = findChild<Record<string, unknown>>(nvPicPr, "cNvPr")
	const shapeName = String(getAttribute(cNvPr, "name") ?? "Picture")
	const descr = String(getAttribute(cNvPr, "descr") ?? "").trim()

	const blipFill = findChild<Record<string, unknown>>(node, "blipFill")
	const blip = findChild<Record<string, unknown>>(blipFill, "blip")
	const relationshipId = String(getAttribute(blip, "embed") ?? "")
	if (!relationshipId) {
		return undefined
	}

	const imagePath = context.relMap.get(relationshipId)
	if (!imagePath) {
		return undefined
	}

	const imageBuffer = await context.zip.file(imagePath)?.async("nodebuffer")
	if (!imageBuffer) {
		return undefined
	}

	const extension = path.posix.extname(imagePath) || ".jpg"
	const streamInfo = new StreamInfo({
		extension,
		mimetype: String(
			mime.lookup(`placeholder${extension}`) || "application/octet-stream",
		),
		filename: path.posix.basename(imagePath),
	})

	const llmDescription =
		context.options.llmClient && context.options.llmModel
			? await llmCaption(
					imageBuffer,
					streamInfo,
					context.options.llmClient,
					context.options.llmModel,
					context.options.llmPrompt,
				).catch(() => undefined)
			: undefined

	const altText = sanitizeAltText(
		[llmDescription, descr].filter(Boolean).join("\n") || shapeName,
	)
	if (context.options.keepDataUris) {
		return `![${altText}](data:${streamInfo.mimetype};base64,${imageBuffer.toString("base64")})`
	}

	return `![${altText}](${sanitizePlaceholderName(shapeName)}.jpg)`
}

async function processGraphicFrame(
	node: Record<string, unknown>,
	context: SlideContext,
): Promise<string | undefined> {
	const graphic = findChild<Record<string, unknown>>(node, "graphic")
	const graphicData = findChild<Record<string, unknown>>(graphic, "graphicData")
	if (!graphicData) {
		return undefined
	}

	const table = findChild<Record<string, unknown>>(graphicData, "tbl")
	if (table) {
		return tableToMarkdown(table)
	}

	const chart = findChild<Record<string, unknown>>(graphicData, "chart")
	if (chart) {
		const relationshipId = String(getAttribute(chart, "id") ?? "")
		const chartPath = context.relMap.get(relationshipId)
		if (!chartPath) {
			return "[unsupported chart]"
		}

		const chartXml = await context.zip.file(chartPath)?.async("string")
		if (!chartXml) {
			return "[unsupported chart]"
		}

		return chartToMarkdown(chartXml)
	}

	return undefined
}

function tableToMarkdown(table: Record<string, unknown>): string {
	const rows = findChildren<Record<string, unknown>>(table, "tr").map((row) =>
		findChildren<Record<string, unknown>>(row, "tc").map((cell) =>
			toArray(findChild(cell, "txBody"))
				.flatMap((txBody) =>
					toArray(findChild(txBody as Record<string, unknown>, "p")),
				)
				.map((paragraph) => extractText(paragraph).trim())
				.join(" ")
				.trim(),
		),
	)

	if (rows.length === 0) {
		return ""
	}

	const width = Math.max(...rows.map((row) => row.length), 0)
	const normalized = rows.map((row) =>
		[...row, ...Array(Math.max(0, width - row.length)).fill("")].slice(
			0,
			width,
		),
	)

	return [
		`| ${normalized[0].join(" | ")} |`,
		`| ${Array(width).fill("---").join(" | ")} |`,
		...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
	].join("\n")
}

function chartToMarkdown(chartXml: string): string {
	try {
		const parsed = parser.parse(chartXml)
		const chartSpace = findChild<Record<string, unknown>>(parsed, "chartSpace")
		const chart = findChild<Record<string, unknown>>(chartSpace, "chart")
		const title = extractText(findChild(chart, "title")).trim()
		const plotArea = findChild<Record<string, unknown>>(chart, "plotArea")
		const chartType = Object.entries(plotArea ?? {}).find(([key]) =>
			localName(key).endsWith("Chart"),
		)?.[1] as Record<string, unknown> | undefined

		if (!chartType) {
			return "[unsupported chart]"
		}

		const series = findChildren<Record<string, unknown>>(chartType, "ser")
		if (series.length === 0) {
			return "[unsupported chart]"
		}

		const categories = readChartPoints(findChild(series[0], "cat"))
		const header = ["Category", ...series.map((item) => readSeriesName(item))]
		const rows = categories.map((category, index) => [
			category,
			...series.map(
				(item) => readChartPoints(findChild(item, "val"))[index] ?? "",
			),
		])

		return [
			`### Chart${title ? `: ${title}` : ""}`,
			"",
			`| ${header.join(" | ")} |`,
			`|${header.map(() => "---").join("|")}|`,
			...rows.map((row) => `| ${row.join(" | ")} |`),
		].join("\n")
	} catch {
		return "[unsupported chart]"
	}
}

function readChartPoints(node: unknown): string[] {
	const ref =
		findChild<Record<string, unknown>>(node, "numRef") ??
		findChild<Record<string, unknown>>(node, "strRef")
	const cache =
		findChild<Record<string, unknown>>(ref, "numCache") ??
		findChild<Record<string, unknown>>(ref, "strCache")
	return findChildren<Record<string, unknown>>(cache, "pt")
		.sort(
			(left, right) =>
				Number(getAttribute(left, "idx") ?? 0) -
				Number(getAttribute(right, "idx") ?? 0),
		)
		.map((point) => extractText(point).trim())
}

function readSeriesName(series: Record<string, unknown>): string {
	const tx = findChild<Record<string, unknown>>(series, "tx")
	const strRef = findChild<Record<string, unknown>>(tx, "strRef")
	const strCache = findChild<Record<string, unknown>>(strRef, "strCache")
	const point = findChildren<Record<string, unknown>>(strCache, "pt")[0]
	return extractText(point).trim() || extractText(tx).trim()
}

async function parseRelationships(
	zip: JSZip,
	relPath: string,
	sourcePath: string,
): Promise<Map<string, string>> {
	const relXml = await zip.file(relPath)?.async("string")
	const map = new Map<string, string>()
	if (!relXml) {
		return map
	}

	const parsed = parser.parse(relXml)
	const relationships = findChild<Record<string, unknown>>(
		parsed,
		"Relationships",
	)
	for (const relationship of findChildren<Record<string, unknown>>(
		relationships,
		"Relationship",
	)) {
		const id = String(getAttribute(relationship, "Id") ?? "")
		const target = String(getAttribute(relationship, "Target") ?? "")
		if (!id || !target) {
			continue
		}

		map.set(
			id,
			path.posix.normalize(
				path.posix.join(path.posix.dirname(sourcePath), target),
			),
		)
	}

	return map
}

function sanitizeAltText(value: string): string {
	return value
		.replace(/[\r\n[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
}

function sanitizePlaceholderName(value: string): string {
	return value.replace(/[^\w]/g, "") || "Picture"
}

function getSlideNumber(slidePath: string): number {
	return Number(/slide(\d+)\.xml$/i.exec(slidePath)?.[1] ?? "0")
}
