import { XMLParser } from "fast-xml-parser";
import { DocumentConverter, DocumentConverterResult } from "../base-converter.js";
import { decodeBuffer } from "../utils/stream.js";
import { htmlToMarkdown } from "../markdown.js";
import type { ConvertOptions } from "../types.js";

const PRECISE_MIME_TYPE_PREFIXES = [
  "application/rss",
  "application/rss+xml",
  "application/atom",
  "application/atom+xml",
];
const PRECISE_FILE_EXTENSIONS = [".rss", ".atom"];
const CANDIDATE_MIME_TYPE_PREFIXES = ["text/xml", "application/xml"];
const CANDIDATE_FILE_EXTENSIONS = [".xml"];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
});

export class RssConverter extends DocumentConverter {
  accepts({ buffer, streamInfo }: Parameters<DocumentConverter["accepts"]>[0]): boolean {
    const mimetype = streamInfo.mimetype?.toLowerCase() ?? "";
    const extension = streamInfo.extension?.toLowerCase() ?? "";

    if (
      PRECISE_FILE_EXTENSIONS.includes(extension) ||
      PRECISE_MIME_TYPE_PREFIXES.some((prefix) => mimetype.startsWith(prefix))
    ) {
      return true;
    }

    if (
      CANDIDATE_FILE_EXTENSIONS.includes(extension) ||
      CANDIDATE_MIME_TYPE_PREFIXES.some((prefix) => mimetype.startsWith(prefix))
    ) {
      return this.detectFeedType(decodeBuffer(buffer, streamInfo.charset)) !== undefined;
    }

    return false;
  }

  convert(
    { buffer, streamInfo }: Parameters<DocumentConverter["convert"]>[0],
    options: ConvertOptions,
  ): DocumentConverterResult {
    const xml = decodeBuffer(buffer, streamInfo.charset);
    const feedType = this.detectFeedType(xml);
    const parsed = parser.parse(xml);

    if (feedType === "rss") {
      const channel = parsed?.rss?.channel;
      const title = getNodeText(channel?.title);
      const description = getNodeText(channel?.description);
      const items = toArray(channel?.item);

      let markdown = title ? `# ${title}\n` : "";
      if (description) {
        markdown += `${description}\n`;
      }

      for (const item of items) {
        const itemTitle = getNodeText(item?.title);
        const pubDate = getNodeText(item?.pubDate);
        const desc = getNodeText(item?.description);
        const content = getNodeText(item?.["content:encoded"]);

        if (itemTitle) {
          markdown += `\n## ${itemTitle}\n`;
        }
        if (pubDate) {
          markdown += `Published on: ${pubDate}\n`;
        }
        if (desc) {
          markdown += parseFeedContent(desc, options);
        }
        if (content) {
          markdown += parseFeedContent(content, options);
        }
      }

      return new DocumentConverterResult(markdown.trim(), title);
    }

    if (feedType === "atom") {
      const feed = parsed?.feed;
      const title = getNodeText(feed?.title);
      const subtitle = getNodeText(feed?.subtitle);
      const entries = toArray(feed?.entry);
      let markdown = title ? `# ${title}\n` : "";
      if (subtitle) {
        markdown += `${subtitle}\n`;
      }

      for (const entry of entries) {
        const entryTitle = getNodeText(entry?.title);
        const updated = getNodeText(entry?.updated);
        const summary = getNodeText(entry?.summary);
        const content = getNodeText(entry?.content);

        if (entryTitle) {
          markdown += `\n## ${entryTitle}\n`;
        }
        if (updated) {
          markdown += `Updated on: ${updated}\n`;
        }
        if (summary) {
          markdown += parseFeedContent(summary, options);
        }
        if (content) {
          markdown += parseFeedContent(content, options);
        }
      }

      return new DocumentConverterResult(markdown.trim(), title);
    }

    throw new TypeError("Unknown feed type.");
  }

  private detectFeedType(xml: string): "rss" | "atom" | undefined {
    try {
      const parsed = parser.parse(xml);
      if (parsed?.rss) {
        return "rss";
      }
      if (parsed?.feed?.entry) {
        return "atom";
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}

function parseFeedContent(content: string, options: ConvertOptions): string {
  try {
    return `${htmlToMarkdown(content, options).markdown}\n`;
  } catch {
    return `${content}\n`;
  }
}

function getNodeText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: unknown })["#text"];
    if (typeof text === "string") {
      return text;
    }
  }
  return undefined;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
