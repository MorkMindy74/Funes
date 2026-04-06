import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises"
import { join } from "node:path"
import { env } from "../env.js"

const UPLOAD_DIR = env.UPLOAD_DIR

/** Ensure upload directory exists */
async function ensureDir(dir: string) {
	await mkdir(dir, { recursive: true })
}

/** Save a file to local storage */
export async function saveFile(
	filename: string,
	data: Buffer | Uint8Array,
	subdir = "",
): Promise<string> {
	const dir = subdir ? join(UPLOAD_DIR, subdir) : UPLOAD_DIR
	await ensureDir(dir)

	const filepath = join(dir, filename)
	await writeFile(filepath, data)
	return filepath
}

/** Read a file from local storage */
export async function getFile(filename: string, subdir = ""): Promise<Buffer> {
	const dir = subdir ? join(UPLOAD_DIR, subdir) : UPLOAD_DIR
	return readFile(join(dir, filename))
}

/** Delete a file from local storage */
export async function deleteFile(filename: string, subdir = ""): Promise<void> {
	const dir = subdir ? join(UPLOAD_DIR, subdir) : UPLOAD_DIR
	try {
		await unlink(join(dir, filename))
	} catch {
		// File may not exist — that's ok
	}
}

/** Check if a file exists */
export async function fileExists(
	filename: string,
	subdir = "",
): Promise<boolean> {
	const dir = subdir ? join(UPLOAD_DIR, subdir) : UPLOAD_DIR
	try {
		await stat(join(dir, filename))
		return true
	} catch {
		return false
	}
}
