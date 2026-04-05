import type { ConvertOptions, MaybePromise } from "./types.js";
import { StreamInfo } from "./stream-info.js";

export class DocumentConverterResult {
  constructor(
    public markdown: string,
    public title?: string,
  ) {}

  get textContent(): string {
    return this.markdown;
  }

  set textContent(value: string) {
    this.markdown = value;
  }

  toString(): string {
    return this.markdown;
  }
}

export interface ConverterInput {
  readonly buffer: Buffer;
  readonly streamInfo: StreamInfo;
}

export abstract class DocumentConverter {
  accepts(
    _input: ConverterInput,
    _options: ConvertOptions,
  ): MaybePromise<boolean> {
    return false;
  }

  abstract convert(
    input: ConverterInput,
    options: ConvertOptions,
  ): MaybePromise<DocumentConverterResult>;
}
