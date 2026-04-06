export function localName(name: string): string {
	const normalized = name.startsWith("@_") ? name.slice(2) : name
	const index = normalized.indexOf(":")
	return index >= 0 ? normalized.slice(index + 1) : normalized
}

export function toArray<T>(value: T | T[] | undefined | null): T[] {
	if (value === undefined || value === null) {
		return []
	}
	return Array.isArray(value) ? value : [value]
}

export function findChild<T = unknown>(
	node: unknown,
	wanted: string,
): T | undefined {
	if (!node || typeof node !== "object") {
		return undefined
	}

	for (const [key, value] of Object.entries(node)) {
		if (key.startsWith("@_")) {
			continue
		}
		if (localName(key) === wanted) {
			return value as T
		}
	}

	return undefined
}

export function findChildren<T = unknown>(node: unknown, wanted: string): T[] {
	if (!node || typeof node !== "object") {
		return []
	}

	const values: T[] = []
	for (const [key, value] of Object.entries(node)) {
		if (key.startsWith("@_")) {
			continue
		}
		if (localName(key) === wanted) {
			values.push(...toArray(value as T | T[]))
		}
	}
	return values
}

export function getAttribute(node: unknown, wanted: string): unknown {
	if (!node || typeof node !== "object") {
		return undefined
	}

	for (const [key, value] of Object.entries(node)) {
		if (localName(key) === wanted) {
			return value
		}
	}

	return undefined
}

export function extractText(node: unknown): string {
	if (node === undefined || node === null) {
		return ""
	}

	if (typeof node === "string") {
		return node
	}

	if (typeof node === "number" || typeof node === "boolean") {
		return String(node)
	}

	if (Array.isArray(node)) {
		return node.map((item) => extractText(item)).join("")
	}

	if (typeof node === "object") {
		let text = ""
		for (const [key, value] of Object.entries(node)) {
			if (key.startsWith("@_")) {
				continue
			}
			const name = localName(key)
			if (name === "t" && typeof value === "string") {
				text += value
			} else if (name === "br") {
				text += "\n"
			} else {
				text += extractText(value)
			}
		}
		return text
	}

	return ""
}
