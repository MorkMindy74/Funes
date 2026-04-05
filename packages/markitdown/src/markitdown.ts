import { DocumentConverter, DocumentConverterResult } from "./base-converter.js";
import {
  FileConversionError,
  FailedConversionAttempt,
  UnsupportedFormatError,
} from "./errors.js";
import { PythonBridge } from "./python-bridge.js";
import { StreamInfo } from "./stream-info.js";
import type { BinarySource, ConvertOptions, MarkItDownOptions } from "./types.js";
import { fileUriToPath, parseDataUri } from "./uri-utils.js";
import {
  BingSerpConverter,
  CsvConverter,
  DocxConverter,
  EpubConverter,
  HtmlConverter,
  ImageConverter,
  IpynbConverter,
  OutlookMsgConverter,
  PdfConverter,
  PlainTextConverter,
  PptxConverter,
  RssConverter,
  YouTubeConverter,
  WikipediaConverter,
  XlsConverter,
  XlsxConverter,
  ZipConverter,
} from "./converters/index.js";
import {
  ensureLeadingDot,
  guessStreamInfo,
  normalizeCharset,
  readBinarySource,
} from "./utils/stream.js";

// Lazy imports for Node.js-only modules (not available in Cloudflare Workers)
let _readFile: typeof import("node:fs/promises").readFile | undefined;
let _path: typeof import("node:path") | undefined;

async function getReadFile() {
  if (!_readFile) {
    try {
      const fs = await import("node:fs/promises");
      _readFile = fs.readFile;
    } catch {
      throw new Error(
        "File system access is not available in this runtime. Use convertBuffer() or convertUri() instead.",
      );
    }
  }
  return _readFile;
}

interface PathLike {
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
  extname(p: string): string;
  basename(p: string): string;
}

function getPath(): PathLike {
  if (!_path) {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic import for runtime compat
      _path = require("node:path") as any;
    } catch {
      // Provide minimal path utilities for non-Node runtimes
      _path = {
        resolve: (...parts: string[]) => parts.join("/"),
        join: (...parts: string[]) => parts.join("/"),
        extname: (p: string) => {
          const dot = p.lastIndexOf(".");
          return dot > 0 ? p.slice(dot) : "";
        },
        basename: (p: string) => {
          const sep = p.lastIndexOf("/");
          return sep >= 0 ? p.slice(sep + 1) : p;
        },
      } as typeof import("node:path");
    }
  }
  return _path!;
}

const PRIORITY_SPECIFIC_FILE_FORMAT = 0;
const PRIORITY_GENERIC_FILE_FORMAT = 10;

interface ConverterRegistration {
  converter: DocumentConverter;
  priority: number;
}

export class MarkItDown {
  private readonly fetchImpl: typeof fetch;
  private readonly pythonBridge: PythonBridge;
  private readonly converters: ConverterRegistration[] = [];
  private builtinsEnabled = false;
  private readonly globalOptions: ConvertOptions;

  constructor(options: MarkItDownOptions = {}) {
    const p = getPath();
    let cwd: string;
    try {
      cwd = options.workingDirectory ?? p.resolve(process.cwd());
    } catch {
      cwd = options.workingDirectory ?? "/";
    }
    const pythonSourcePath =
      options.pythonSourcePath ?? p.join(cwd, "packages", "markitdown", "src");

    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pythonBridge = new PythonBridge({
      command: options.pythonCommand ?? "python",
      sourcePath: pythonSourcePath,
      cwd,
    });
    this.globalOptions = {
      llmClient: options.llmClient,
      llmModel: options.llmModel,
      llmPrompt: options.llmPrompt,
      exiftoolPath: options.exiftoolPath,
      styleMap: options.styleMap,
      pythonFallback: options.pythonFallback ?? false,
    };

    if (options.enableBuiltins ?? true) {
      this.enableBuiltins();
    }
  }

  enableBuiltins(): void {
    if (this.builtinsEnabled) {
      return;
    }

    this.registerConverter(new PlainTextConverter(), PRIORITY_GENERIC_FILE_FORMAT);
    this.registerConverter(new ZipConverter(this), PRIORITY_GENERIC_FILE_FORMAT);
    this.registerConverter(new HtmlConverter(), PRIORITY_GENERIC_FILE_FORMAT);
    this.registerConverter(new RssConverter());
    this.registerConverter(new WikipediaConverter());
    this.registerConverter(new YouTubeConverter());
    this.registerConverter(new BingSerpConverter());
    this.registerConverter(new DocxConverter());
    this.registerConverter(new XlsxConverter());
    this.registerConverter(new XlsConverter());
    this.registerConverter(new PdfConverter());
    this.registerConverter(new PptxConverter());
    this.registerConverter(new ImageConverter());
    this.registerConverter(new IpynbConverter());
    this.registerConverter(new OutlookMsgConverter());
    this.registerConverter(new EpubConverter());
    this.registerConverter(new CsvConverter());
    this.builtinsEnabled = true;
  }

  registerConverter(
    converter: DocumentConverter,
    priority = PRIORITY_SPECIFIC_FILE_FORMAT,
  ): void {
    this.converters.unshift({ converter, priority });
  }

  async convert(
    source: string | URL | Response | BinarySource,
    options: ConvertOptions & { streamInfo?: StreamInfo } = {},
  ): Promise<DocumentConverterResult> {
    if (typeof source === "string") {
      if (/^(https?|file|data):/i.test(source)) {
        return this.convertUri(source, options.streamInfo, options);
      }
      return this.convertLocal(source, options.streamInfo, options);
    }

    if (source instanceof URL) {
      return this.convertUri(source.toString(), options.streamInfo, options);
    }

    if (isResponse(source)) {
      return this.convertResponse(source, options.streamInfo, options);
    }

    return this.convertBuffer(await readBinarySource(source), options.streamInfo, options);
  }

  async convertStream(
    source: BinarySource,
    streamInfo?: StreamInfo,
    options: ConvertOptions = {},
  ): Promise<DocumentConverterResult> {
    return this.convertBuffer(await readBinarySource(source), streamInfo, options);
  }

  async convertLocal(
    targetPath: string,
    streamInfo?: StreamInfo,
    options: ConvertOptions = {},
  ): Promise<DocumentConverterResult> {
    const p = getPath();
    const baseGuess = new StreamInfo({
      localPath: targetPath,
      extension: ensureLeadingDot(p.extname(targetPath)),
      filename: p.basename(targetPath),
    }).copyAndUpdate(streamInfo);

    if (options.preferPython) {
      return this.pythonBridge.convertPath(targetPath, baseGuess, this.mergeOptions(options));
    }

    const readFileFn = await getReadFile();
    const buffer = await readFileFn(targetPath);
    return this.convertBufferWithFallback(
      buffer,
      baseGuess,
      options,
      () => this.pythonBridge.convertPath(targetPath, baseGuess, this.mergeOptions(options)),
    );
  }

  async convertBuffer(
    buffer: Buffer,
    streamInfo?: StreamInfo,
    options: ConvertOptions = {},
  ): Promise<DocumentConverterResult> {
    const baseGuess = new StreamInfo().copyAndUpdate(streamInfo);
    if (options.preferPython) {
      return this.pythonBridge.convertBuffer(buffer, baseGuess, this.mergeOptions(options));
    }

    return this.convertBufferWithFallback(
      buffer,
      baseGuess,
      options,
      () => this.pythonBridge.convertBuffer(buffer, baseGuess, this.mergeOptions(options)),
    );
  }

  async convertUri(
    uri: string,
    streamInfo?: StreamInfo,
    options: ConvertOptions = {},
  ): Promise<DocumentConverterResult> {
    const trimmed = uri.trim();
    if (trimmed.startsWith("file:")) {
      const parsed = fileUriToPath(trimmed);
      if (parsed.netloc && parsed.netloc !== "localhost") {
        throw new TypeError(`Unsupported file URI: ${trimmed}`);
      }
      return this.convertLocal(parsed.path, streamInfo, {
        ...options,
      });
    }

    if (trimmed.startsWith("data:")) {
      const data = parseDataUri(trimmed);
      const baseGuess = new StreamInfo({
        mimetype: data.mimetype,
        charset: data.attributes.charset,
      }).copyAndUpdate(streamInfo);
      return this.convertBuffer(data.data, baseGuess, options);
    }

    if (/^https?:/i.test(trimmed)) {
      if (options.preferPython) {
        return this.pythonBridge.convertUri(trimmed, streamInfo ?? new StreamInfo(), this.mergeOptions(options));
      }

      const response = await this.fetchImpl(trimmed, {
        headers: {
          Accept: "text/markdown, text/html;q=0.9, text/plain;q=0.8, */*;q=0.1",
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${trimmed}`);
      }
      return this.convertResponse(response, new StreamInfo({ url: trimmed }).copyAndUpdate(streamInfo), options);
    }

    throw new TypeError(`Unsupported URI scheme: ${trimmed}`);
  }

  async convertResponse(
    response: Response,
    streamInfo?: StreamInfo,
    options: ConvertOptions = {},
  ): Promise<DocumentConverterResult> {
    const contentType = response.headers.get("content-type") ?? undefined;
    const [mimetypePart, ...params] = (contentType ?? "").split(";").map((part) => part.trim());
    const charset = params
      .find((part) => part.toLowerCase().startsWith("charset="))
      ?.split("=", 2)[1];

    const contentDisposition = response.headers.get("content-disposition") ?? undefined;
    let filename: string | undefined;
    let extension: string | undefined;
    const p = getPath();
    const filenameMatch = contentDisposition ? /filename=([^;]+)/i.exec(contentDisposition) : null;
    if (filenameMatch) {
      filename = filenameMatch[1]?.trim().replace(/^["']|["']$/g, "");
      extension = ensureLeadingDot(p.extname(filename));
    }

    if (!filename) {
      try {
        const responseUrl = new URL(response.url);
        const ext = p.extname(responseUrl.pathname);
        if (ext) {
          filename = p.basename(responseUrl.pathname);
          extension = ensureLeadingDot(ext);
        }
      } catch {
        // Ignore malformed response URL values.
      }
    }

    const baseGuess = new StreamInfo({
      mimetype: mimetypePart || undefined,
      charset: normalizeCharset(charset),
      filename,
      extension,
      url: response.url || streamInfo?.url,
    }).copyAndUpdate(streamInfo);

    const buffer = Buffer.from(await response.arrayBuffer());
    return this.convertBufferWithFallback(
      buffer,
      baseGuess,
      options,
      () => this.pythonBridge.convertBuffer(buffer, baseGuess, this.mergeOptions(options)),
    );
  }

  private async convertBufferWithFallback(
    buffer: Buffer,
    baseGuess: StreamInfo,
    options: ConvertOptions,
    fallback: () => Promise<DocumentConverterResult>,
  ): Promise<DocumentConverterResult> {
    try {
      const guesses = await guessStreamInfo(buffer, baseGuess);
      return await this.convertNative(buffer, guesses, options);
    } catch (error) {
      if (!this.shouldUsePythonFallback(options)) {
        throw error;
      }
      return fallback();
    }
  }

  private async convertNative(
    buffer: Buffer,
    streamInfoGuesses: StreamInfo[],
    options: ConvertOptions,
  ): Promise<DocumentConverterResult> {
    const failures: FailedConversionAttempt[] = [];
    const registrations = [...this.converters].sort((left, right) => left.priority - right.priority);
    const mergedOptions = this.mergeOptions(options);

    for (const streamInfo of [...streamInfoGuesses, new StreamInfo()]) {
      for (const registration of registrations) {
        const input = { buffer, streamInfo };
        const accepts = await registration.converter.accepts(input, mergedOptions);
        if (!accepts) {
          continue;
        }

        try {
          const result = await registration.converter.convert(input, mergedOptions);
          return normalizeResult(result);
        } catch (error) {
          failures.push(
            new FailedConversionAttempt(registration.converter.constructor.name, error),
          );
        }
      }
    }

    if (failures.length > 0) {
      throw FileConversionError.fromAttempts(failures);
    }

    throw new UnsupportedFormatError(
      "Could not convert stream to Markdown. No converter attempted a conversion.",
    );
  }

  private mergeOptions(options: ConvertOptions): ConvertOptions {
    return {
      ...this.globalOptions,
      ...options,
    };
  }

  private shouldUsePythonFallback(options: ConvertOptions): boolean {
    const merged = this.mergeOptions(options);
    return Boolean(merged.pythonFallback) && !merged._disablePythonFallback;
  }
}

function normalizeResult(result: DocumentConverterResult): DocumentConverterResult {
  result.textContent = result.textContent
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return result;
}

function isResponse(value: unknown): value is Response {
  return typeof Response !== "undefined" && value instanceof Response;
}
