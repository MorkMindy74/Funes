import mime from "mime-types";
import type { StreamInfo } from "./stream-info.js";

export async function llmCaption(
  buffer: Buffer,
  streamInfo: StreamInfo,
  client: unknown,
  model: string,
  prompt?: string,
): Promise<string | undefined> {
  const normalizedPrompt =
    prompt && prompt.trim().length > 0
      ? prompt
      : "Write a detailed caption for this image.";

  const contentType =
    streamInfo.mimetype ??
    (streamInfo.extension ? mime.lookup(`placeholder${streamInfo.extension}`) : false) ??
    "application/octet-stream";
  const dataUri = `data:${contentType};base64,${buffer.toString("base64")}`;

  const requestClient = client as {
    chat?: {
      completions?: {
        create?: (args: {
          model: string;
          messages: Array<{
            role: string;
            content: Array<
              | { type: "text"; text: string }
              | { type: "image_url"; image_url: { url: string } }
            >;
          }>;
        }) =>
          | Promise<{ choices?: Array<{ message?: { content?: string | null } }> }>
          | { choices?: Array<{ message?: { content?: string | null } }> };
      };
    };
  };

  const create = requestClient.chat?.completions?.create;
  if (!create) {
    return undefined;
  }

  const response = await create({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: normalizedPrompt },
          { type: "image_url", image_url: { url: dataUri } },
        ],
      },
    ],
  });

  const message = response.choices?.[0]?.message?.content;
  return typeof message === "string" ? message : undefined;
}
