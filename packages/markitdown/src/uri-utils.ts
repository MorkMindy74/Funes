import path from "node:path"

export interface ParsedDataUri {
	mimetype?: string
	attributes: Record<string, string>
	data: Buffer
}

export function parseDataUri(uri: string): ParsedDataUri {
	const match = /^data:([^,]*?),(.*)$/is.exec(uri)
	if (!match) {
		throw new TypeError("Invalid data URI.")
	}

	const metadata = match[1] ?? ""
	const dataPart = match[2] ?? ""
	const attributes: Record<string, string> = {}
	let mimetype: string | undefined
	let isBase64 = false

	for (const [index, part] of metadata.split(";").filter(Boolean).entries()) {
		if (part.toLowerCase() === "base64") {
			isBase64 = true
			continue
		}

		if (index === 0 && !part.includes("=") && part.includes("/")) {
			mimetype = part
			continue
		}

		const [key, value] = part.split("=", 2)
		if (key && value) {
			attributes[key] = value
		}
	}

	const data = isBase64
		? Buffer.from(dataPart, "base64")
		: Buffer.from(decodeURIComponent(dataPart), "utf8")

	return { mimetype, attributes, data }
}

export function fileUriToPath(uri: string): {
	netloc?: string
	path: string
} {
	const url = new URL(uri)
	const pathname = decodeURIComponent(url.pathname)

	if (process.platform === "win32") {
		return {
			netloc: url.host || undefined,
			path: path.win32.normalize(pathname.replace(/^\/+/, "")),
		}
	}

	return { netloc: url.host || undefined, path: pathname }
}
