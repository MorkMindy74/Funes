declare module "turndown-plugin-gfm" {
  export function gfm(service: unknown): void;
}

declare module "youtube-transcript/dist/youtube-transcript.esm.js" {
  export interface TranscriptPart {
    text: string;
    duration: number;
    offset: number;
    lang?: string;
  }

  export class YoutubeTranscript {
    static fetchTranscript(
      videoId: string,
      config?: { lang?: string },
    ): Promise<TranscriptPart[]>;
  }
}
