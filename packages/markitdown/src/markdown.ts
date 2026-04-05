import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import type { ConvertOptions } from "./types.js";

export function htmlToMarkdown(
  html: string,
  options: ConvertOptions = {},
): { markdown: string; title?: string } {
  const $ = cheerio.load(html);
  $("script,style").remove();

  const bodyHtml =
    $("body").length > 0
      ? $("body").first().html() ?? ""
      : $.root().html() ?? "";
  const turndown = createTurndown(options);
  const markdown = normalizeMarkdown(turndown.turndown(bodyHtml));
  const title = $("title").first().text().trim() || undefined;
  return { markdown, title };
}

export function createTurndown(options: ConvertOptions = {}): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });

  turndown.use(gfm);

  turndown.addRule("links", {
    filter: "a",
    replacement(content: string, node: Node) {
      const element = node as HTMLElement;
      const href = element.getAttribute("href") ?? "";
      const title = element.getAttribute("title");
      const text = content.trim();

      if (!text) {
        return "";
      }

      if (isRejectedHref(href)) {
        return text;
      }

      if (!href) {
        return text;
      }

      const titlePart = title ? ` "${title.replaceAll('"', '\\"')}"` : "";
      return `[${text}](${href}${titlePart})`;
    },
  });

  turndown.addRule("images", {
    filter: "img",
    replacement(_content: string, node: Node) {
      const element = node as HTMLElement;
      const alt = (element.getAttribute("alt") ?? "").replace(/\s+/g, " ").trim();
      let src =
        element.getAttribute("src") ?? element.getAttribute("data-src") ?? "";
      const title = element.getAttribute("title");

      if (src.startsWith("data:") && !options.keepDataUris) {
        src = `${src.split(",")[0]}...`;
      }

      const titlePart = title ? ` "${title.replaceAll('"', '\\"')}"` : "";
      return `![${alt}](${src}${titlePart})`;
    },
  });

  turndown.addRule("checkboxes", {
    filter: "input",
    replacement(_content: string, node: Node) {
      const element = node as HTMLElement;
      if (element.getAttribute("type") !== "checkbox") {
        return "";
      }

      return element.hasAttribute("checked") ? "[x] " : "[ ] ";
    },
  });

  return turndown;
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRejectedHref(href: string): boolean {
  if (!href) {
    return false;
  }

  const trimmed = href.trim().toLowerCase();
  if (
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:")
  ) {
    return true;
  }

  return false;
}
