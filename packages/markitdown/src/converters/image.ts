import exifr from "exifr";
import { DocumentConverter, DocumentConverterResult } from "../base-converter.js";
import { llmCaption } from "../llm-caption.js";
import { StreamInfo } from "../stream-info.js";
import type { ConvertOptions } from "../types.js";

const ACCEPTED_MIME_TYPE_PREFIXES = ["image/jpeg", "image/png"];
const ACCEPTED_FILE_EXTENSIONS = [".jpg", ".jpeg", ".png"];

export class ImageConverter extends DocumentConverter {
  accepts({ streamInfo }: Parameters<DocumentConverter["accepts"]>[0]): boolean {
    const mimetype = streamInfo.mimetype?.toLowerCase() ?? "";
    const extension = streamInfo.extension?.toLowerCase() ?? "";
    return (
      ACCEPTED_FILE_EXTENSIONS.includes(extension) ||
      ACCEPTED_MIME_TYPE_PREFIXES.some((prefix) => mimetype.startsWith(prefix))
    );
  }

  async convert(
    { buffer, streamInfo }: Parameters<DocumentConverter["convert"]>[0],
    options: ConvertOptions,
  ): Promise<DocumentConverterResult> {
    const metadata = await exifr.parse(buffer, true).catch(() => undefined);
    const lines: string[] = [];

    const basicSize = getImageSize(buffer, streamInfo);
    const orderedFields: Array<[string, string | undefined]> = [
      ["ImageSize", basicSize],
      ["Title", readString(metadata?.title)],
      ["Caption", readString(metadata?.Caption)],
      [
        "Description",
        readString(metadata?.description) ??
          readString(metadata?.ImageDescription) ??
          readString(metadata?.Description),
      ],
      ["Keywords", readKeywords(metadata?.Keywords)],
      ["Artist", readString(metadata?.Artist)],
      ["Author", readString(metadata?.Author)],
      ["DateTimeOriginal", formatExifDate(metadata?.DateTimeOriginal)],
      ["CreateDate", formatExifDate(metadata?.CreateDate)],
      ["GPSPosition", readGpsPosition(metadata)],
    ];

    for (const [key, value] of orderedFields) {
      if (value) {
        lines.push(`${key}: ${value}`);
      }
    }

    if (options.llmClient && options.llmModel) {
      const description = await llmCaption(
        buffer,
        streamInfo ?? new StreamInfo(),
        options.llmClient,
        options.llmModel,
        options.llmPrompt,
      ).catch(() => undefined);

      if (description) {
        lines.push("", "# Description:", description.trim());
      }
    }

    return new DocumentConverterResult(lines.join("\n").trim());
  }
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && "value" in value) {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "string") {
      return inner;
    }
  }

  return undefined;
}

function readKeywords(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return readString(value);
}

function formatExifDate(value: unknown): string | undefined {
  const raw = readString(value);
  if (!raw) {
    return undefined;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}:${month}:${day} ${hours}:${minutes}:${seconds}`;
}

function readGpsPosition(metadata: Record<string, unknown> | undefined): string | undefined {
  const latitude = typeof metadata?.latitude === "number" ? metadata.latitude : undefined;
  const longitude = typeof metadata?.longitude === "number" ? metadata.longitude : undefined;
  if (latitude === undefined || longitude === undefined) {
    return undefined;
  }
  return `${latitude}, ${longitude}`;
}

function getImageSize(buffer: Buffer, streamInfo: StreamInfo): string | undefined {
  const extension = streamInfo.extension?.toLowerCase();
  if (extension === ".png") {
    return readPngSize(buffer);
  }
  if (extension === ".jpg" || extension === ".jpeg" || streamInfo.mimetype === "image/jpeg") {
    return readJpegSize(buffer);
  }
  return undefined;
}

function readPngSize(buffer: Buffer): string | undefined {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return undefined;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return `${width}x${height}`;
}

function readJpegSize(buffer: Buffer): string | undefined {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const blockLength = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return `${width}x${height}`;
    }

    offset += 2 + blockLength;
  }
  return undefined;
}
