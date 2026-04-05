import * as cheerio from "cheerio";
import { DocumentConverter, DocumentConverterResult } from "../base-converter.js";
import { decodeBuffer } from "../utils/stream.js";
import { htmlToMarkdown } from "../markdown.js";
import type { ConvertOptions } from "../types.js";

const ACCEPTED_MIME_TYPE_PREFIXES = ["text/html", "application/xhtml"];
const ACCEPTED_FILE_EXTENSIONS = [".html", ".htm"];

export class HtmlConverter extends DocumentConverter {
  accepts({ streamInfo }: Parameters<DocumentConverter["accepts"]>[0]): boolean {
    const mimetype = streamInfo.mimetype?.toLowerCase() ?? "";
    const extension = streamInfo.extension?.toLowerCase() ?? "";
    return (
      ACCEPTED_FILE_EXTENSIONS.includes(extension) ||
      ACCEPTED_MIME_TYPE_PREFIXES.some((prefix) => mimetype.startsWith(prefix))
    );
  }

  convert(
    { buffer, streamInfo }: Parameters<DocumentConverter["convert"]>[0],
    options: ConvertOptions,
  ): DocumentConverterResult {
    const html = decodeBuffer(buffer, streamInfo.charset);
    const result = htmlToMarkdown(html, options);
    return new DocumentConverterResult(result.markdown, result.title);
  }

  convertString(html: string, options: ConvertOptions = {}): DocumentConverterResult {
    const result = htmlToMarkdown(html, options);
    return new DocumentConverterResult(result.markdown, result.title);
  }

  protected loadHtml(buffer: Buffer, charset?: string | null): cheerio.CheerioAPI {
    return cheerio.load(decodeBuffer(buffer, charset));
  }
}
