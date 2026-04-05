import * as XLSX from "xlsx";
import { DocumentConverter, DocumentConverterResult } from "../base-converter.js";
import type { ConvertOptions } from "../types.js";

const ACCEPTED_XLSX_MIME_TYPE_PREFIXES = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
const ACCEPTED_XLSX_FILE_EXTENSIONS = [".xlsx"];

const ACCEPTED_XLS_MIME_TYPE_PREFIXES = ["application/vnd.ms-excel", "application/excel"];
const ACCEPTED_XLS_FILE_EXTENSIONS = [".xls"];

export class XlsxConverter extends DocumentConverter {
  accepts({ streamInfo }: Parameters<DocumentConverter["accepts"]>[0]): boolean {
    const mimetype = streamInfo.mimetype?.toLowerCase() ?? "";
    const extension = streamInfo.extension?.toLowerCase() ?? "";
    return (
      ACCEPTED_XLSX_FILE_EXTENSIONS.includes(extension) ||
      ACCEPTED_XLSX_MIME_TYPE_PREFIXES.some((prefix) => mimetype.startsWith(prefix))
    );
  }

  convert(
    { buffer }: Parameters<DocumentConverter["convert"]>[0],
    _options: ConvertOptions,
  ): DocumentConverterResult {
    return convertWorkbook(buffer);
  }
}

export class XlsConverter extends DocumentConverter {
  accepts({ streamInfo }: Parameters<DocumentConverter["accepts"]>[0]): boolean {
    const mimetype = streamInfo.mimetype?.toLowerCase() ?? "";
    const extension = streamInfo.extension?.toLowerCase() ?? "";
    return (
      ACCEPTED_XLS_FILE_EXTENSIONS.includes(extension) ||
      ACCEPTED_XLS_MIME_TYPE_PREFIXES.some((prefix) => mimetype.startsWith(prefix))
    );
  }

  convert(
    { buffer }: Parameters<DocumentConverter["convert"]>[0],
    _options: ConvertOptions,
  ): DocumentConverterResult {
    return convertWorkbook(buffer);
  }
}

function convertWorkbook(buffer: Buffer): DocumentConverterResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellText: true, cellDates: false });
  const sections: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
      defval: "",
    });

    sections.push(`## ${sheetName}`);
    if (rows.length === 0) {
      sections.push("");
      continue;
    }

    const width = Math.max(...rows.map((row) => row.length), 0);
    const normalized = rows.map((row) =>
      [...row.map((cell) => String(cell ?? "")), ...Array(Math.max(0, width - row.length)).fill("")]
        .slice(0, width),
    );
    sections.push(`| ${normalized[0].join(" | ")} |`);
    sections.push(`| ${Array(width).fill("---").join(" | ")} |`);
    for (const row of normalized.slice(1)) {
      sections.push(`| ${row.join(" | ")} |`);
    }
    sections.push("");
  }

  return new DocumentConverterResult(sections.join("\n").trim());
}
