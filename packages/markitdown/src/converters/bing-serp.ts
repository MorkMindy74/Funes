import * as cheerio from "cheerio";
import { DocumentConverter, DocumentConverterResult } from "../base-converter.js";
import { decodeBuffer } from "../utils/stream.js";
import { createTurndown } from "../markdown.js";
import type { ConvertOptions } from "../types.js";

const ACCEPTED_MIME_TYPE_PREFIXES = ["text/html", "application/xhtml"];
const ACCEPTED_FILE_EXTENSIONS = [".html", ".htm"];

export class BingSerpConverter extends DocumentConverter {
  accepts({ streamInfo }: Parameters<DocumentConverter["accepts"]>[0]): boolean {
    const url = streamInfo.url ?? "";
    const mimetype = streamInfo.mimetype?.toLowerCase() ?? "";
    const extension = streamInfo.extension?.toLowerCase() ?? "";

    return (
      /^https:\/\/www\.bing\.com\/search\?q=/i.test(url) &&
      (ACCEPTED_FILE_EXTENSIONS.includes(extension) ||
        ACCEPTED_MIME_TYPE_PREFIXES.some((prefix) => mimetype.startsWith(prefix)))
    );
  }

  convert(
    { buffer, streamInfo }: Parameters<DocumentConverter["convert"]>[0],
    options: ConvertOptions,
  ): DocumentConverterResult {
    const url = new URL(streamInfo.url ?? "https://www.bing.com/search?q=");
    const query = url.searchParams.get("q") ?? "";
    const html = decodeBuffer(buffer, streamInfo.charset);
    const $ = cheerio.load(html);

    $(".tptt").each((_, element) => {
      const node = $(element);
      node.text(`${node.text()} `);
    });
    $(".algoSlug_icon").remove();

    const turndown = createTurndown(options);
    const results: string[] = [];
    $(".b_algo").each((_, element) => {
      const node = $(element);
      node.find("a[href]").each((__, anchor) => {
        const href = $(anchor).attr("href");
        if (!href) {
          return;
        }

        try {
          const parsed = new URL(href);
          const encoded = parsed.searchParams.get("u");
          if (!encoded || encoded.length < 3) {
            return;
          }

          const decoded = Buffer.from(padBase64Url(encoded.slice(2)), "base64").toString("utf8");
          $(anchor).attr("href", decoded);
        } catch {
          // Keep original href on parse failures.
        }
      });

      const markdown = turndown
        .turndown($.html(node))
        .split(/\n+/)
        .map((line: string) => line.trim())
        .filter(Boolean)
        .join("\n");

      if (markdown) {
        results.push(markdown);
      }
    });

    return new DocumentConverterResult(
      `## A Bing search for '${query}' found the following results:\n\n${results.join("\n\n")}`.trim(),
      $("title").text().trim() || undefined,
    );
  }
}

function padBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = normalized.length % 4;
  return padLength === 0 ? normalized : normalized.padEnd(normalized.length + (4 - padLength), "=");
}
