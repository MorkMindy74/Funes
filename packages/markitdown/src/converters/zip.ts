import path from "node:path";
import JSZip from "jszip";
import { DocumentConverter, DocumentConverterResult } from "../base-converter.js";
import { FileConversionError, UnsupportedFormatError } from "../errors.js";
import { StreamInfo } from "../stream-info.js";
import type { ConvertOptions } from "../types.js";
import type { MarkItDown } from "../markitdown.js";

const ACCEPTED_MIME_TYPE_PREFIXES = ["application/zip"];
const ACCEPTED_FILE_EXTENSIONS = [".zip"];

export class ZipConverter extends DocumentConverter {
  constructor(private readonly markitdown: MarkItDown) {
    super();
  }

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
    const filePath = streamInfo.url ?? streamInfo.localPath ?? streamInfo.filename ?? "archive.zip";
    const zip = await JSZip.loadAsync(buffer);
    const sections = [`Content from the zip file \`${filePath}\`:\n`];

    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) {
        continue;
      }

      const nestedBuffer = await entry.async("nodebuffer");
      const nestedInfo = new StreamInfo({
        extension: path.extname(name),
        filename: path.basename(name),
      });

      try {
        const result = await this.markitdown.convertBuffer(nestedBuffer, nestedInfo, {
          ...options,
          _disablePythonFallback: options._disablePythonFallback,
        });

        sections.push(`## File: ${name}\n\n${result.markdown}\n`);
      } catch (error) {
        if (error instanceof UnsupportedFormatError || error instanceof FileConversionError) {
          continue;
        }
        throw error;
      }
    }

    return new DocumentConverterResult(sections.join("\n").trim());
  }
}
