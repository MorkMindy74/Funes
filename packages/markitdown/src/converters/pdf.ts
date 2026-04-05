import { DocumentConverter, DocumentConverterResult } from "../base-converter.js";
import { llmCaption } from "../llm-caption.js";
import { StreamInfo } from "../stream-info.js";
import type { ConvertOptions } from "../types.js";

const ACCEPTED_MIME_TYPE_PREFIXES = ["application/pdf", "application/x-pdf"];
const ACCEPTED_FILE_EXTENSIONS = [".pdf"];
const PARTIAL_NUMBERING_PATTERN = /^\.\d+$/;

interface PositionedWord {
  text: string;
  x0: number;
  x1: number;
  y: number;
  height: number;
  avgCharWidth: number;
}

interface TextRow {
  y: number;
  words: PositionedWord[];
  text: string;
  height: number;
}

interface TableRowInfo extends TextRow {
  xGroups: number[];
  isParagraph: boolean;
  numColumns: number;
  hasPartialNumbering: boolean;
  alignedColumnCount?: number;
  isTableRow?: boolean;
}

export class PdfConverter extends DocumentConverter {
  accepts({ streamInfo }: Parameters<DocumentConverter["accepts"]>[0]): boolean {
    const mimetype = streamInfo.mimetype?.toLowerCase() ?? "";
    const extension = streamInfo.extension?.toLowerCase() ?? "";

    return (
      ACCEPTED_FILE_EXTENSIONS.includes(extension) ||
      ACCEPTED_MIME_TYPE_PREFIXES.some((prefix) => mimetype.startsWith(prefix))
    );
  }

  async convert(
    { buffer }: Parameters<DocumentConverter["convert"]>[0],
    options: ConvertOptions,
  ): Promise<DocumentConverterResult> {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      isEvalSupported: false,
      useWorkerFetch: false,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    });

    const document = await loadingTask.promise;
    const hasLlm = Boolean(options.llmClient && options.llmModel);
    // Track image hashes to skip duplicates (repeated logos, headers)
    const seenImageHashes = new Set<string>();
    // Track total captions generated (mutable counter object)
    const captionCounter = { count: 0 };

    try {
      const markdownChunks: string[] = [];

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        try {
          const viewport = page.getViewport({ scale: 1 });
          const content = await page.getTextContent();
          const formContent = extractFormContentFromItems(content.items, viewport.width);
          const pageContent =
            formContent ?? extractPlainTextFromItems(content.items, viewport.width);

          if (pageContent.trim()) {
            markdownChunks.push(pageContent.trim());
          }

          // Extract and caption embedded images if LLM is available
          if (hasLlm) {
            const imageCaptions = await extractAndCaptionImages(
              page,
              pdfjs.OPS,
              options,
              seenImageHashes,
              captionCounter,
            );
            if (imageCaptions.length > 0) {
              markdownChunks.push(imageCaptions.join("\n\n"));
            }
          }
        } finally {
          page.cleanup();
        }
      }

      return new DocumentConverterResult(
        mergePartialNumberingLines(markdownChunks.join("\n\n").trim()),
      );
    } finally {
      await document.destroy();
    }
  }
}

// Minimum image dimensions to avoid captioning logos, icons, bullets
const MIN_IMAGE_WIDTH = 100;
const MIN_IMAGE_HEIGHT = 100;
// Maximum images to caption per PDF to avoid excessive LLM calls
const MAX_IMAGES_PER_PDF = 20;

/**
 * Extract embedded images from a PDF page and generate LLM captions.
 * Filters out small images (logos, icons) and deduplicates repeated images.
 */
async function extractAndCaptionImages(
  // biome-ignore lint/suspicious/noExplicitAny: pdfjs page type is complex
  page: any,
  // biome-ignore lint/suspicious/noExplicitAny: pdfjs OPS type
  OPS: any,
  options: ConvertOptions,
  seenHashes: Set<string>,
  captionCounter: { count: number },
): Promise<string[]> {
  const captions: string[] = [];

  try {
    const operatorList = await page.getOperatorList();
    const { fnArray, argsArray } = operatorList;

    for (let i = 0; i < fnArray.length; i++) {
      if (captionCounter.count >= MAX_IMAGES_PER_PDF) break;

      // paintImageXObject is the operator that renders raster images
      if (fnArray[i] !== OPS.paintImageXObject) continue;

      const imageObjId = argsArray[i]?.[0];
      if (!imageObjId) continue;

      try {
        const imgData = await getPageObject(page, imageObjId);
        if (!imgData) continue;

        const width = imgData.width ?? 0;
        const height = imgData.height ?? 0;

        // Skip small images (logos, icons, bullets)
        if (width < MIN_IMAGE_WIDTH || height < MIN_IMAGE_HEIGHT) continue;

        // Extract raw pixel data
        const rawData: Uint8Array | Uint8ClampedArray | undefined =
          imgData.data ?? imgData.bitmap?.data;
        if (!rawData || rawData.length === 0) continue;

        // Simple hash to deduplicate repeated images (e.g. headers/footers)
        const hash = simpleHash(rawData, width, height);
        if (seenHashes.has(hash)) continue;
        seenHashes.add(hash);

        // Encode raw RGBA pixel data as PNG
        const pngBuffer = encodePng(rawData, width, height, imgData.kind);
        if (!pngBuffer) continue;

        // Call LLM for captioning
        const description = await llmCaption(
          pngBuffer,
          new StreamInfo({ mimetype: "image/png" }),
          options.llmClient!,
          options.llmModel!,
          options.llmPrompt ??
            "Describe this image from a PDF document in detail. If it's a chart, table, or diagram, describe the data and key insights. Be concise but thorough.",
        ).catch(() => undefined);

        if (description) {
          captionCounter.count++;
          captions.push(
            `**[Embedded image, ${width}x${height}]:** ${description.trim()}`,
          );
        }
      } catch {
        // Skip individual image extraction failures
        continue;
      }
    }
  } catch {
    // If getOperatorList fails, silently skip image extraction
  }

  return captions;
}

/**
 * Safely get a page object by ID, with timeout protection.
 */
// biome-ignore lint/suspicious/noExplicitAny: pdfjs types
async function getPageObject(page: any, objId: string): Promise<any> {
  return new Promise((resolve) => {
    try {
      // page.objs.get can be sync (cached) or async (via callback)
      const result = page.objs.get(objId, (data: unknown) => resolve(data));
      if (result !== undefined) resolve(result);
      // Safety timeout: don't wait forever for an image object
      setTimeout(() => resolve(undefined), 3000);
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Simple hash for deduplication — samples bytes at intervals
 * to produce a fast fingerprint without hashing the full buffer.
 */
function simpleHash(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): string {
  let hash = `${width}x${height}:`;
  const step = Math.max(1, Math.floor(data.length / 64));
  for (let i = 0; i < data.length; i += step) {
    hash += String.fromCharCode(((data[i] ?? 0) % 94) + 33);
  }
  return hash;
}

/**
 * Encode raw pixel data as a minimal PNG.
 * Supports RGBA (kind=2), RGB (kind=1), and grayscale (kind=0) from pdfjs.
 *
 * This is a lightweight PNG encoder that doesn't require canvas or sharp.
 * It produces uncompressed PNGs suitable for LLM vision analysis.
 */
function encodePng(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  kind?: number,
): Buffer | undefined {
  try {
    // Normalize to RGBA
    let rgba: Uint8Array;
    const pixelCount = width * height;

    if (kind === 2 || data.length === pixelCount * 4) {
      // Already RGBA
      rgba = data instanceof Uint8Array ? data : new Uint8Array(data);
    } else if (kind === 1 || data.length === pixelCount * 3) {
      // RGB -> RGBA
      rgba = new Uint8Array(pixelCount * 4);
      for (let i = 0; i < pixelCount; i++) {
        rgba[i * 4] = data[i * 3] ?? 0;
        rgba[i * 4 + 1] = data[i * 3 + 1] ?? 0;
        rgba[i * 4 + 2] = data[i * 3 + 2] ?? 0;
        rgba[i * 4 + 3] = 255;
      }
    } else if (kind === 0 || data.length === pixelCount) {
      // Grayscale -> RGBA
      rgba = new Uint8Array(pixelCount * 4);
      for (let i = 0; i < pixelCount; i++) {
        const v = data[i] ?? 0;
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
      }
    } else {
      return undefined;
    }

    // Build raw IDAT data: filter byte (0 = None) + row bytes for each row
    const rawRowSize = 1 + width * 4;
    const rawData = new Uint8Array(rawRowSize * height);
    for (let y = 0; y < height; y++) {
      rawData[y * rawRowSize] = 0; // Filter: None
      rawData.set(
        rgba.subarray(y * width * 4, (y + 1) * width * 4),
        y * rawRowSize + 1,
      );
    }

    // Use DeflateRaw if available (Node.js), otherwise create uncompressed deflate
    let compressed: Buffer;
    try {
      const zlib = require("node:zlib");
      compressed = zlib.deflateSync(Buffer.from(rawData));
    } catch {
      // Fallback: create a stored (uncompressed) zlib stream
      compressed = createStoredDeflate(rawData);
    }

    // Build PNG file
    const chunks: Buffer[] = [];

    // PNG signature
    chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    // IHDR
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type: RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace
    chunks.push(createPngChunk("IHDR", ihdr));

    // IDAT
    chunks.push(createPngChunk("IDAT", compressed));

    // IEND
    chunks.push(createPngChunk("IEND", Buffer.alloc(0)));

    return Buffer.concat(chunks);
  } catch {
    return undefined;
  }
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

/**
 * Create a stored (uncompressed) zlib/deflate stream for environments
 * where node:zlib is not available (e.g. Cloudflare Workers).
 */
function createStoredDeflate(data: Uint8Array): Buffer {
  // Zlib header (CMF=0x78, FLG=0x01 = no dict, low compression)
  const header = Buffer.from([0x78, 0x01]);

  // Split into 65535-byte blocks (max for stored deflate)
  const blocks: Buffer[] = [];
  const maxBlock = 65535;
  for (let offset = 0; offset < data.length; offset += maxBlock) {
    const end = Math.min(offset + maxBlock, data.length);
    const isLast = end === data.length;
    const blockData = data.subarray(offset, end);
    const blockHeader = Buffer.alloc(5);
    blockHeader[0] = isLast ? 0x01 : 0x00;
    blockHeader.writeUInt16LE(blockData.length, 1);
    blockHeader.writeUInt16LE(blockData.length ^ 0xffff, 3);
    blocks.push(blockHeader);
    blocks.push(Buffer.from(blockData));
  }

  // Adler-32 checksum
  const adler = adler32(data);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler, 0);

  return Buffer.concat([header, ...blocks, checksum]);
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + (data[i] ?? 0)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// CRC-32 lookup table
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[(crc ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mergePartialNumberingLines(text: string): string {
  const lines = text.split("\n");
  const resultLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const stripped = line.trim();

    if (!PARTIAL_NUMBERING_PATTERN.test(stripped)) {
      resultLines.push(line);
      continue;
    }

    let nextIndex = index + 1;
    while (nextIndex < lines.length && !(lines[nextIndex] ?? "").trim()) {
      nextIndex += 1;
    }

    if (nextIndex < lines.length) {
      resultLines.push(`${stripped} ${(lines[nextIndex] ?? "").trim()}`);
      index = nextIndex;
      continue;
    }

    resultLines.push(line);
  }

  return resultLines.join("\n");
}

function extractPlainTextFromItems(items: unknown[], pageWidth: number): string {
  const rows = buildRows(items);
  if (rows.length === 0) {
    return "";
  }

  return formatRowsWithSpacing(rows, pageWidth);
}

function extractFormContentFromItems(items: unknown[], pageWidth: number): string | null {
  const rows = buildRows(items);
  if (rows.length === 0) {
    return null;
  }

  const rowInfo: TableRowInfo[] = rows.map((row) => {
    const firstWord = row.words[0];
    const lastWord = row.words[row.words.length - 1];
    const lineWidth = lastWord.x1 - firstWord.x0;
    const xGroups: number[] = [];

    for (const word of row.words) {
      if (xGroups.length === 0 || word.x0 - xGroups[xGroups.length - 1] > 50) {
        xGroups.push(word.x0);
      }
    }

    return {
      ...row,
      xGroups,
      isParagraph: lineWidth > pageWidth * 0.55 && row.text.length > 60,
      numColumns: xGroups.length,
      hasPartialNumbering: Boolean(firstWord) && PARTIAL_NUMBERING_PATTERN.test(firstWord.text),
    };
  });

  const allTableXPositions = rowInfo
    .filter((row) => row.numColumns >= 3 && !row.isParagraph)
    .flatMap((row) => row.xGroups)
    .sort((left, right) => left - right);

  if (allTableXPositions.length === 0) {
    return null;
  }

  const gaps: number[] = [];
  for (let index = 0; index < allTableXPositions.length - 1; index += 1) {
    const gap = allTableXPositions[index + 1] - allTableXPositions[index];
    if (gap > 5) {
      gaps.push(gap);
    }
  }

  let adaptiveTolerance = 35;
  if (gaps.length >= 3) {
    const sortedGaps = [...gaps].sort((left, right) => left - right);
    const percentileIndex = Math.floor(sortedGaps.length * 0.7);
    adaptiveTolerance = clamp(sortedGaps[percentileIndex] ?? 35, 25, 50);
  }

  const globalColumns: number[] = [];
  for (const xPosition of allTableXPositions) {
    if (
      globalColumns.length === 0 ||
      xPosition - globalColumns[globalColumns.length - 1] > adaptiveTolerance
    ) {
      globalColumns.push(xPosition);
    }
  }

  if (globalColumns.length <= 1) {
    return null;
  }

  const contentWidth = globalColumns[globalColumns.length - 1] - globalColumns[0];
  const avgColumnWidth = contentWidth / globalColumns.length;
  if (avgColumnWidth < 30) {
    return null;
  }

  const columnsPerInch = globalColumns.length / Math.max(contentWidth / 72, 0.01);
  if (columnsPerInch > 10) {
    return null;
  }

  const adaptiveMaxColumns = Math.max(15, Math.floor(20 * (pageWidth / 612)));
  if (globalColumns.length > adaptiveMaxColumns) {
    return null;
  }

  for (const row of rowInfo) {
    if (row.isParagraph || row.hasPartialNumbering) {
      row.isTableRow = false;
      continue;
    }

    const alignedColumns = new Set<number>();
    for (const word of row.words) {
      for (let index = 0; index < globalColumns.length; index += 1) {
        if (Math.abs(word.x0 - globalColumns[index]) < 40) {
          alignedColumns.add(index);
          break;
        }
      }
    }

    row.alignedColumnCount = alignedColumns.size;
    row.isTableRow = alignedColumns.size >= 3;
  }

  const tableRegions: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < rowInfo.length; ) {
    if (!rowInfo[index]?.isTableRow) {
      index += 1;
      continue;
    }

    const start = index;
    while (index < rowInfo.length && rowInfo[index]?.isTableRow) {
      index += 1;
    }
    let expandedStart = start;
    while (
      (rowInfo[expandedStart - 1]?.alignedColumnCount ?? 0) >= 2 &&
      (rowInfo[expandedStart - 1]?.y ?? 0) - (rowInfo[expandedStart]?.y ?? 0) <= 30
    ) {
      expandedStart -= 1;
    }

    let expandedEnd = index;
    while (
      (rowInfo[expandedEnd]?.alignedColumnCount ?? 0) >= 2 &&
      (rowInfo[expandedEnd - 1]?.y ?? 0) - (rowInfo[expandedEnd]?.y ?? 0) <= 30
    ) {
      expandedEnd += 1;
    }

    tableRegions.push({ start: expandedStart, end: expandedEnd });
    index = expandedEnd;
  }

  const totalTableRows = tableRegions.reduce((sum, region) => sum + (region.end - region.start), 0);
  if (rowInfo.length > 0 && totalTableRows / rowInfo.length < 0.2) {
    return null;
  }

  const lines: string[] = [];
  let previousNonTableRow: TextRow | undefined;

  for (let index = 0; index < rowInfo.length; ) {
    const startingRegion = tableRegions.find((region) => region.start === index);
    if (startingRegion) {
      const tableRows = rowInfo.slice(startingRegion.start, startingRegion.end);
      const tableData = tableRows.map((row) => extractCells(row, globalColumns));
      const tableMarkdown = formatMarkdownTable(tableData);
      if (tableMarkdown) {
        if (lines.length > 0 && lines[lines.length - 1] !== "") {
          lines.push("");
        }
        lines.push(tableMarkdown);
        lines.push("");
      }
      index = startingRegion.end;
      previousNonTableRow = undefined;
      continue;
    }

    const insideRegion = tableRegions.some(
      (region) => index > region.start && index < region.end,
    );
    if (!insideRegion) {
      appendTextRow(lines, previousNonTableRow, rowInfo[index], pageWidth);
      previousNonTableRow = rowInfo[index];
    }
    index += 1;
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildRows(items: unknown[]): TextRow[] {
  const words = extractPositionedWords(items);
  if (words.length === 0) {
    return [];
  }

  const rowsByY = new Map<number, PositionedWord[]>();
  for (const word of words) {
    const yKey = Math.round(word.y / 5) * 5;
    const bucket = rowsByY.get(yKey) ?? [];
    bucket.push(word);
    rowsByY.set(yKey, bucket);
  }

  return [...rowsByY.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([y, rowWords]) => {
      rowWords.sort((left, right) => left.x0 - right.x0);
      return {
        y,
        words: rowWords,
        text: buildLineText(rowWords),
        height: Math.max(...rowWords.map((word) => word.height), 0),
      };
    })
    .filter((row) => row.text.length > 0);
}

function extractPositionedWords(items: unknown[]): PositionedWord[] {
  const words: PositionedWord[] = [];

  for (const item of items) {
    if (!isTextItem(item)) {
      continue;
    }

    const text = item.str.trim();
    if (!text) {
      continue;
    }

    const x0 = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const height = Math.abs(item.height ?? item.transform[0] ?? item.transform[3] ?? 0);
    const width = Math.max(item.width ?? 0, height * 0.5);

    words.push({
      text,
      x0,
      x1: x0 + width,
      y,
      height,
      avgCharWidth: width / Math.max(text.length, 1),
    });
  }

  return words;
}

function formatRowsWithSpacing(rows: TextRow[], pageWidth: number): string {
  const lines: string[] = [];
  let previousRow: TextRow | undefined;

  for (const row of rows) {
    appendTextRow(lines, previousRow, row, pageWidth);
    previousRow = row;
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function appendTextRow(
  lines: string[],
  previousRow: TextRow | undefined,
  row: TextRow,
  pageWidth: number,
): void {
  if (previousRow) {
    const verticalGap = previousRow.y - row.y;
    const baselineGap = Math.max(previousRow.height, row.height, 10);
    const isParagraphBreak =
      verticalGap > baselineGap * 1.6 ||
      (verticalGap > baselineGap * 1.2 && row.words[0]!.x0 - 10 < pageWidth * 0.2);

    if (isParagraphBreak && lines[lines.length - 1] !== "") {
      lines.push("");
    }
  }

  lines.push(row.text);
}

function extractCells(row: TableRowInfo, globalColumns: number[]): string[] {
  const cells = Array.from({ length: globalColumns.length }, () => "");

  for (const word of row.words) {
    let assignedColumn = globalColumns.length - 1;
    for (let index = 0; index < globalColumns.length - 1; index += 1) {
      if (word.x0 < globalColumns[index + 1] - 20) {
        assignedColumn = index;
        break;
      }
    }

    cells[assignedColumn] = cells[assignedColumn]
      ? `${cells[assignedColumn]} ${word.text}`
      : word.text;
  }

  return cells.map((cell) => cell.trim());
}

function formatMarkdownTable(rows: string[][]): string {
  const nonEmptyRows = rows.filter((row) => row.some((cell) => cell.trim().length > 0));
  if (nonEmptyRows.length === 0) {
    return "";
  }

  const columnWidths = nonEmptyRows[0]!.map((_, columnIndex) =>
    Math.max(
      3,
      ...nonEmptyRows.map((row) => (row[columnIndex] ?? "").length),
    ),
  );

  const formatRow = (row: string[]): string =>
    `| ${row
      .map((cell, index) => (cell ?? "").padEnd(columnWidths[index], " "))
      .join(" | ")} |`;

  const [header, ...body] = nonEmptyRows;
  const separator = `| ${columnWidths.map((width) => "-".repeat(width)).join(" | ")} |`;

  return [formatRow(header), separator, ...body.map((row) => formatRow(row))].join("\n");
}

function buildLineText(words: PositionedWord[]): string {
  let line = "";
  let previousWord: PositionedWord | undefined;

  for (const word of words) {
    if (!previousWord) {
      line = word.text;
      previousWord = word;
      continue;
    }

    const gap = word.x0 - previousWord.x1;
    const shouldInsertSpace =
      !line.endsWith("-") &&
      !/^[,.;:!?%)]/.test(word.text) &&
      gap >= -0.5;

    line += shouldInsertSpace ? ` ${word.text}` : word.text;
    previousWord = word;
  }

  return line.replace(/[ \t]+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isTextItem(
  item: unknown,
): item is { str: string; transform: number[]; width: number; height?: number } {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof (item as { str: unknown }).str === "string" &&
    "transform" in item &&
    Array.isArray((item as { transform: unknown }).transform)
  );
}
