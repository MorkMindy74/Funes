export { VERSION } from "./about.js";
export { DocumentConverter, DocumentConverterResult } from "./base-converter.js";
export {
  FileConversionError,
  MarkItDownError,
  MissingDependencyError,
  UnsupportedFormatError,
} from "./errors.js";
export { MarkItDown } from "./markitdown.js";
export { StreamInfo } from "./stream-info.js";
export * from "./converters/index.js";
export type { BinarySource, ConvertOptions, MarkItDownOptions } from "./types.js";

// Funes-specific utilities
export { preprocessContent, type PreprocessOptions, type PreprocessResult } from "./preprocess.js";
export { detectDocumentType } from "./detect-type.js";
