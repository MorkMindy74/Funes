import * as cheerio from "cheerio";
import { DocumentConverter, DocumentConverterResult } from "../base-converter.js";
import { decodeBuffer } from "../utils/stream.js";
import { createTurndown } from "../markdown.js";
import type { ConvertOptions } from "../types.js";

const ACCEPTED_MIME_TYPE_PREFIXES = ["text/html", "application/xhtml"];
const ACCEPTED_FILE_EXTENSIONS = [".html", ".htm"];

export class WikipediaConverter extends DocumentConverter {
  accepts({ streamInfo }: Parameters<DocumentConverter["accepts"]>[0]): boolean {
    const url = streamInfo.url ?? "";
    const mimetype = streamInfo.mimetype?.toLowerCase() ?? "";
    const extension = streamInfo.extension?.toLowerCase() ?? "";

    return (
      /^https?:\/\/[a-z]{2,3}\.wikipedia\.org\//i.test(url) &&
      (ACCEPTED_FILE_EXTENSIONS.includes(extension) ||
        ACCEPTED_MIME_TYPE_PREFIXES.some((prefix) => mimetype.startsWith(prefix)))
    );
  }

  convert(
    { buffer, streamInfo }: Parameters<DocumentConverter["convert"]>[0],
    options: ConvertOptions,
  ): DocumentConverterResult {
    const html = decodeBuffer(buffer, streamInfo.charset);
    const $ = cheerio.load(html);
    $("script,style").remove();

    const body = $("#mw-content-text").first();
    const title = $(".mw-page-title-main").first().text().trim() || $("title").text().trim() || undefined;
    const turndown = createTurndown(options);
    const content = body.length > 0 ? turndown.turndown(body.html() ?? "") : turndown.turndown($.html());
    const markdown = title ? `# ${title}\n\n${content}` : content;
    return new DocumentConverterResult(markdown.trim(), title);
  }
}
