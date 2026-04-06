#!/usr/bin/env node
import { writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { parseArgs } from "node:util"
import { VERSION } from "./about.js"
import { MarkItDown } from "./markitdown.js"
import { StreamInfo } from "./stream-info.js"
import {
	ensureLeadingDot,
	normalizeCharset,
	readBinarySource,
} from "./utils/stream.js"

const usage = `SYNTAX:

    markitdown <OPTIONAL: FILENAME>
    If FILENAME is empty, markitdown reads from stdin.

EXAMPLE:

    markitdown example.pdf

    OR

    cat example.pdf | markitdown

    OR

    markitdown < example.pdf

    OR to save to a file use

    markitdown example.pdf -o example.md

    OR

    markitdown example.pdf > example.md`

async function main(): Promise<void> {
	const cliOptions = {
		version: { type: "boolean", short: "v" },
		output: { type: "string", short: "o" },
		extension: { type: "string", short: "x" },
		"mime-type": { type: "string", short: "m" },
		charset: { type: "string", short: "c" },
		"use-docintel": { type: "boolean", short: "d" },
		endpoint: { type: "string", short: "e" },
		"use-plugins": { type: "boolean", short: "p" },
		"list-plugins": { type: "boolean" },
		"keep-data-uris": { type: "boolean" },
		help: { type: "boolean", short: "h" },
	} as const

	let parsed: ReturnType<typeof parseArgs<typeof cliOptions>>
	try {
		parsed = parseArgs({
			options: cliOptions,
			allowPositionals: true,
			strict: true,
		})
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n\n${usage}\n`,
		)
		process.exitCode = 1
		return
	}

	const values = parsed.values
	if (values.help) {
		process.stdout.write(`${usage}\n`)
		return
	}

	if (values.version) {
		process.stdout.write(`markitdown ${VERSION}\n`)
		return
	}

	if (values["list-plugins"]) {
		process.stdout.write(
			"Installed MarkItDown 3rd-party Plugins:\n\n  * No native TypeScript plugin discovery is configured yet.\n",
		)
		return
	}

	if (values["use-docintel"] && !values.endpoint) {
		process.stderr.write(
			"Document Intelligence Endpoint is required when using Document Intelligence.\n",
		)
		process.exitCode = 1
		return
	}

	const streamInfo = new StreamInfo({
		extension: ensureLeadingDot(values.extension),
		mimetype: values["mime-type"],
		charset: normalizeCharset(values.charset),
	})

	const filename = parsed.positionals[0]
	const markitdown = new MarkItDown({
		enablePlugins: values["use-plugins"],
	})

	const result = filename
		? await markitdown.convert(filename, {
				streamInfo,
				keepDataUris: values["keep-data-uris"],
				preferPython: values["use-docintel"],
			})
		: await markitdown.convertBuffer(
				await readBinarySource(process.stdin),
				streamInfo,
				{
					keepDataUris: values["keep-data-uris"],
					preferPython: values["use-docintel"],
				},
			)

	if (values.output) {
		await writeFile(path.resolve(values.output), result.markdown, "utf8")
		return
	}

	process.stdout.write(`${result.markdown}\n`)
}

void main()
