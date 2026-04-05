import type { Readable } from "node:stream";

export type MaybePromise<T> = T | Promise<T>;

export interface ConvertOptions {
  keepDataUris?: boolean;
  llmClient?: unknown;
  llmModel?: string;
  llmPrompt?: string;
  exiftoolPath?: string;
  styleMap?: string | string[];
  youtubeTranscriptLanguages?: string[];
  preferPython?: boolean;
  pythonFallback?: boolean;
  _disablePythonFallback?: boolean;
}

export interface MarkItDownOptions extends ConvertOptions {
  enableBuiltins?: boolean;
  enablePlugins?: boolean;
  fetchImpl?: typeof fetch;
  pythonCommand?: string;
  pythonSourcePath?: string;
  workingDirectory?: string;
}

export type BinarySource =
  | Buffer
  | Uint8Array
  | ArrayBuffer
  | Readable
  | NodeJS.ReadableStream;
