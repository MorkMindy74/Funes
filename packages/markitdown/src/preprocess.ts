/**
 * High-level preprocessing utility for Funes memory pipeline.
 * Converts any supported input (URL, Buffer, HTML string) to clean Markdown.
 */
import { MarkItDown } from "./markitdown.js";
import { StreamInfo } from "./stream-info.js";
import type { DocumentConverterResult } from "./base-converter.js";

let _instance: MarkItDown | null = null;

function getInstance(): MarkItDown {
	if (!_instance) {
		_instance = new MarkItDown({
			pythonFallback: false,
			enableBuiltins: true,
		});
	}
	return _instance;
}

export interface PreprocessOptions {
	/** Original filename (helps with format detection) */
	filename?: string;
	/** MIME type of the content */
	mimeType?: string;
}

export interface PreprocessResult {
	markdown: string;
	title?: string;
}

/**
 * Convert any supported content to Markdown.
 *
 * - If `input` is a string starting with http(s)://, it's treated as a URL
 * - If `input` is a Buffer/Uint8Array, it's converted based on filename/mimeType hints
 * - If `input` is a plain string (not a URL), it's returned as-is
 */
export async function preprocessContent(
	input: string | Buffer | Uint8Array,
	options: PreprocessOptions = {},
): Promise<PreprocessResult> {
	const markitdown = getInstance();

	// URL input
	if (typeof input === "string" && /^https?:\/\//i.test(input)) {
		const result = await markitdown.convertUri(input);
		return toResult(result);
	}

	// Buffer input
	if (input instanceof Buffer || input instanceof Uint8Array) {
		const buffer = input instanceof Buffer ? input : Buffer.from(input);
		const streamInfo = new StreamInfo({
			filename: options.filename,
			mimetype: options.mimeType,
			extension: options.filename ? extractExtension(options.filename) : undefined,
		});
		const result = await markitdown.convertBuffer(buffer, streamInfo);
		return toResult(result);
	}

	// Plain text string — return as-is
	return { markdown: input };
}

function toResult(result: DocumentConverterResult): PreprocessResult {
	return {
		markdown: result.textContent,
		title: result.title,
	};
}

function extractExtension(filename: string): string | undefined {
	const dot = filename.lastIndexOf(".");
	return dot > 0 ? filename.slice(dot) : undefined;
}
