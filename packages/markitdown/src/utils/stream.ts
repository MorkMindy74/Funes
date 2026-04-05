import { Readable } from "node:stream";
import { fileTypeFromBuffer } from "file-type";
import iconv from "iconv-lite";
import jschardet from "jschardet";
import mime from "mime-types";
import type { BinarySource } from "../types.js";
import { StreamInfo } from "../stream-info.js";

export async function readBinarySource(source: BinarySource): Promise<Buffer> {
  if (Buffer.isBuffer(source)) {
    return source;
  }

  if (source instanceof Uint8Array) {
    return Buffer.from(source);
  }

  if (source instanceof ArrayBuffer) {
    return Buffer.from(source);
  }

  const readable = source instanceof Readable ? source : Readable.from(source);
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function normalizeCharset(charset?: string | null): string | undefined {
  if (!charset) {
    return undefined;
  }

  try {
    return iconv.encodingExists(charset) ? charset.toLowerCase() : charset;
  } catch {
    return charset;
  }
}

export function decodeBuffer(
  buffer: Buffer,
  charset?: string | null,
): string {
  const normalized = normalizeCharset(charset);
  if (normalized && iconv.encodingExists(normalized)) {
    return iconv.decode(buffer, normalized);
  }

  const detected = jschardet.detect(buffer);
  if (
    detected.encoding &&
    detected.confidence &&
    detected.confidence >= 0.2 &&
    iconv.encodingExists(detected.encoding)
  ) {
    return iconv.decode(buffer, detected.encoding);
  }

  return buffer.toString("utf8");
}

export async function guessStreamInfo(
  buffer: Buffer,
  baseGuess: StreamInfo,
): Promise<StreamInfo[]> {
  const guesses: StreamInfo[] = [];
  let enhancedGuess = baseGuess.copyAndUpdate();

  if (!baseGuess.mimetype && baseGuess.extension) {
    const guessMime = mime.lookup(`placeholder${baseGuess.extension}`);
    if (guessMime) {
      enhancedGuess = enhancedGuess.copyAndUpdate({ mimetype: String(guessMime) });
    }
  }

  if (baseGuess.mimetype && !baseGuess.extension) {
    const guessExtension = mime.extension(baseGuess.mimetype);
    if (guessExtension) {
      enhancedGuess = enhancedGuess.copyAndUpdate({ extension: `.${guessExtension}` });
    }
  }

  const fileType = await fileTypeFromBuffer(buffer);
  if (fileType) {
    const compatible =
      (!baseGuess.mimetype || baseGuess.mimetype === fileType.mime) &&
      (!baseGuess.extension ||
        baseGuess.extension.replace(/^\./, "").toLowerCase() ===
          fileType.ext.toLowerCase());

    if (compatible) {
      guesses.push(
        baseGuess.copyAndUpdate({
          mimetype: baseGuess.mimetype ?? fileType.mime,
          extension: baseGuess.extension ?? `.${fileType.ext}`,
          charset: baseGuess.charset ?? maybeGuessCharset(buffer, fileType.mime),
        }),
      );
    } else {
      guesses.push(enhancedGuess);
      guesses.push(
        new StreamInfo({
          mimetype: fileType.mime,
          extension: `.${fileType.ext}`,
          charset: maybeGuessCharset(buffer, fileType.mime),
          filename: baseGuess.filename,
          localPath: baseGuess.localPath,
          url: baseGuess.url,
        }),
      );
    }
    return guesses;
  }

  guesses.push(
    enhancedGuess.copyAndUpdate({
      charset: enhancedGuess.charset ?? maybeGuessCharset(buffer, enhancedGuess.mimetype),
    }),
  );
  return guesses;
}

function maybeGuessCharset(
  buffer: Buffer,
  mimetype?: string,
): string | undefined {
  if (mimetype && !mimetype.startsWith("text/") && mimetype !== "application/json") {
    return undefined;
  }

  const detected = jschardet.detect(buffer.subarray(0, 4096));
  return normalizeCharset(detected.encoding);
}

export function ensureLeadingDot(extension?: string): string | undefined {
  if (!extension) {
    return undefined;
  }

  return extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
}
