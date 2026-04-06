export interface StreamInfoInit {
	mimetype?: string | null
	extension?: string | null
	charset?: string | null
	filename?: string | null
	localPath?: string | null
	url?: string | null
}

export class StreamInfo {
	readonly mimetype?: string
	readonly extension?: string
	readonly charset?: string
	readonly filename?: string
	readonly localPath?: string
	readonly url?: string

	constructor(init: StreamInfoInit = {}) {
		this.mimetype = init.mimetype ?? undefined
		this.extension = init.extension ?? undefined
		this.charset = init.charset ?? undefined
		this.filename = init.filename ?? undefined
		this.localPath = init.localPath ?? undefined
		this.url = init.url ?? undefined
	}

	copyAndUpdate(
		...updates: Array<StreamInfo | StreamInfoInit | undefined>
	): StreamInfo {
		const merged: StreamInfoInit = {
			mimetype: this.mimetype,
			extension: this.extension,
			charset: this.charset,
			filename: this.filename,
			localPath: this.localPath,
			url: this.url,
		}

		for (const update of updates) {
			if (!update) {
				continue
			}

			const source = update instanceof StreamInfo ? update.toJSON() : update
			for (const [key, value] of Object.entries(source)) {
				if (value !== undefined && value !== null) {
					;(merged as Record<string, string | undefined | null>)[key] = value
				}
			}
		}

		return new StreamInfo(merged)
	}

	toJSON(): StreamInfoInit {
		return {
			mimetype: this.mimetype,
			extension: this.extension,
			charset: this.charset,
			filename: this.filename,
			localPath: this.localPath,
			url: this.url,
		}
	}
}
