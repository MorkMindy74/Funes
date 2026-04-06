import * as msgreader from "@kenjiuno/msgreader"
import {
	DocumentConverter,
	DocumentConverterResult,
} from "../base-converter.js"
import type { ConvertOptions } from "../types.js"

const ACCEPTED_MIME_TYPE_PREFIXES = ["application/vnd.ms-outlook"]
const ACCEPTED_FILE_EXTENSIONS = [".msg"]

type Recipient = {
	email?: string
	name?: string
	recipType?: string
}

type MsgData = {
	subject?: string
	senderEmail?: string
	senderName?: string
	body?: string
	recipients?: Recipient[]
}

export class OutlookMsgConverter extends DocumentConverter {
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
		{ buffer }: Parameters<DocumentConverter["convert"]>[0],
		_options: ConvertOptions,
	): DocumentConverterResult {
		const Reader = resolveMsgReader()
		const message = new Reader(buffer).getFileData() as MsgData
		const toRecipients = (message.recipients ?? [])
			.filter((recipient) => recipient.recipType === "to")
			.map((recipient) => recipient.email || recipient.name)
			.filter((value): value is string => Boolean(value))

		const from = message.senderEmail ?? message.senderName
		const subject = message.subject
		const body = message.body?.trim() ?? ""

		const lines = [
			"# Email Message",
			"",
			from ? `**From:** ${from}` : undefined,
			toRecipients.length > 0
				? `**To:** ${toRecipients.join(", ")}`
				: undefined,
			subject ? `**Subject:** ${subject}` : undefined,
			"",
			"## Content",
			"",
			body,
		].filter((line): line is string => line !== undefined)

		return new DocumentConverterResult(lines.join("\n").trim(), subject)
	}
}

function resolveMsgReader(): new (
	buffer: Buffer,
) => { getFileData(): unknown } {
	const candidate =
		((msgreader as unknown as { default?: { default?: unknown } }).default
			?.default as
			| (new (
					buffer: Buffer,
			  ) => { getFileData(): unknown })
			| undefined) ??
		((msgreader as unknown as { default?: unknown }).default as
			| (new (
					buffer: Buffer,
			  ) => { getFileData(): unknown })
			| undefined)

	if (!candidate) {
		throw new TypeError("Unable to resolve MsgReader constructor.")
	}

	return candidate
}
