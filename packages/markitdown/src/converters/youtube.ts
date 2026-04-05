import * as cheerio from "cheerio";
import {
  YoutubeTranscript,
  type TranscriptPart,
} from "youtube-transcript/dist/youtube-transcript.esm.js";
import { DocumentConverter, DocumentConverterResult } from "../base-converter.js";
import { decodeBuffer } from "../utils/stream.js";
import type { ConvertOptions } from "../types.js";

const ACCEPTED_MIME_TYPE_PREFIXES = ["text/html", "application/xhtml"];
const ACCEPTED_FILE_EXTENSIONS = [".html", ".htm"];

export class YouTubeConverter extends DocumentConverter {
  accepts({ streamInfo }: Parameters<DocumentConverter["accepts"]>[0]): boolean {
    const url = decodeURIComponent(streamInfo.url ?? "")
      .replace(/\\\?/g, "?")
      .replace(/\\=/g, "=");
    const mimetype = streamInfo.mimetype?.toLowerCase() ?? "";
    const extension = streamInfo.extension?.toLowerCase() ?? "";

    return (
      url.startsWith("https://www.youtube.com/watch?") &&
      (ACCEPTED_FILE_EXTENSIONS.includes(extension) ||
        ACCEPTED_MIME_TYPE_PREFIXES.some((prefix) => mimetype.startsWith(prefix)))
    );
  }

  async convert(
    { buffer, streamInfo }: Parameters<DocumentConverter["convert"]>[0],
    options: ConvertOptions,
  ): Promise<DocumentConverterResult> {
    const html = decodeBuffer(buffer, streamInfo.charset);
    const $ = cheerio.load(html);
    const metadata = new Map<string, string>();

    const titleTag = $("title").first().text().trim();
    if (titleTag) {
      metadata.set("title", titleTag);
    }

    $("meta").each((_, element) => {
      const node = $(element);
      const key =
        node.attr("itemprop") ?? node.attr("property") ?? node.attr("name") ?? undefined;
      const content = node.attr("content") ?? undefined;
      if (key && content) {
        metadata.set(key, content);
      }
    });

    const initialData = parseInlineJson(html, "ytInitialData");
    const description = findNestedValue(initialData, "attributedDescriptionBodyText");
    if (description && typeof description === "object" && "content" in description) {
      const content = (description as { content?: unknown }).content;
      if (typeof content === "string" && content.trim().length > 0) {
        metadata.set("description", content);
      }
    }

    const title = firstValue(metadata, ["title", "og:title", "name"]);
    let markdown = "# YouTube\n";
    if (title) {
      markdown += `\n## ${title}\n`;
    }

    const stats: string[] = [];
    const views = firstValue(metadata, ["interactionCount"]);
    const keywords = firstValue(metadata, ["keywords"]);
    const runtime = firstValue(metadata, ["duration"]);
    if (views) {
      stats.push(`- **Views:** ${views}`);
    }
    if (keywords) {
      stats.push(`- **Keywords:** ${keywords}`);
    }
    if (runtime) {
      stats.push(`- **Runtime:** ${runtime}`);
    }
    if (stats.length > 0) {
      markdown += `\n### Video Metadata\n${stats.join("\n")}\n`;
    }

    const textDescription = firstValue(metadata, ["description", "og:description"]);
    if (textDescription) {
      markdown += `\n### Description\n${textDescription}\n`;
    }

    const transcript = await fetchTranscript(streamInfo.url, options).catch(() => undefined);
    if (transcript) {
      markdown += `\n### Transcript\n${transcript}\n`;
    }

    return new DocumentConverterResult(markdown.trim(), title ?? (titleTag || undefined));
  }
}

function firstValue(map: Map<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = map.get(key);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function parseInlineJson(html: string, variableName: string): unknown {
  const marker = `var ${variableName} = `;
  const start = html.indexOf(marker);
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  const jsonStart = start + marker.length;
  for (let index = jsonStart; index < html.length; index += 1) {
    const char = html[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }

  return undefined;
}

function findNestedValue(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findNestedValue(item, key);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  if (node && typeof node === "object") {
    for (const [childKey, value] of Object.entries(node)) {
      if (childKey === key) {
        return value;
      }
      const found = findNestedValue(value, key);
      if (found !== undefined) {
        return found;
      }
    }
  }

  return undefined;
}

async function fetchTranscript(
  url: string | undefined,
  options: ConvertOptions,
): Promise<string | undefined> {
  if (!url) {
    return undefined;
  }

  const languages = options.youtubeTranscriptLanguages ?? [];
  if (languages.length > 0) {
    for (const lang of languages) {
      try {
        const parts = await YoutubeTranscript.fetchTranscript(url, { lang });
        if (parts.length > 0) {
          return parts.map((part: TranscriptPart) => part.text).join(" ");
        }
      } catch {
        // Try next language.
      }
    }
  }

  const parts = await YoutubeTranscript.fetchTranscript(url);
  return parts.length > 0
    ? parts.map((part: TranscriptPart) => part.text).join(" ")
    : undefined;
}
