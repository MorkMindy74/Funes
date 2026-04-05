import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ConvertOptions } from "./types.js";
import { DocumentConverterResult } from "./base-converter.js";
import { StreamInfo } from "./stream-info.js";

export interface PythonBridgeOptions {
  command: string;
  sourcePath: string;
  cwd: string;
}

export class PythonBridge {
  constructor(private readonly options: PythonBridgeOptions) {}

  async convertPath(
    target: string,
    streamInfo: StreamInfo,
    options: ConvertOptions,
  ): Promise<DocumentConverterResult> {
    return this.runCli([target], streamInfo, options);
  }

  async convertUri(
    uri: string,
    streamInfo: StreamInfo,
    options: ConvertOptions,
  ): Promise<DocumentConverterResult> {
    return this.runCli([uri], streamInfo, options);
  }

  async convertBuffer(
    buffer: Buffer,
    streamInfo: StreamInfo,
    options: ConvertOptions,
  ): Promise<DocumentConverterResult> {
    return this.runCli([], streamInfo, options, buffer);
  }

  private async runCli(
    positionalArgs: string[],
    streamInfo: StreamInfo,
    options: ConvertOptions,
    stdin?: Buffer,
  ): Promise<DocumentConverterResult> {
    const args = ["-m", "markitdown"];

    if (streamInfo.extension) {
      args.push("--extension", streamInfo.extension);
    }

    if (streamInfo.mimetype) {
      args.push("--mime-type", streamInfo.mimetype);
    }

    if (streamInfo.charset) {
      args.push("--charset", streamInfo.charset);
    }

    if (options.keepDataUris) {
      args.push("--keep-data-uris");
    }

    args.push(...positionalArgs);

    const env = {
      ...process.env,
      PYTHONPATH: joinPythonPath(process.env.PYTHONPATH, this.options.sourcePath),
    };

    const result = await spawnAndCapture(
      this.options.command,
      args,
      this.options.cwd,
      env,
      stdin,
    );

    return new DocumentConverterResult(result.stdout.trimEnd());
  }

  async convertBufferViaTempFile(
    buffer: Buffer,
    streamInfo: StreamInfo,
    options: ConvertOptions,
  ): Promise<DocumentConverterResult> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "markitdown-ts-"));
    const extension = streamInfo.extension ?? "";
    const filename = streamInfo.filename ?? `${randomUUID()}${extension}`;
    const tempFile = path.join(tempDir, filename);

    try {
      await writeFile(tempFile, buffer);
      return await this.convertPath(tempFile, streamInfo, options);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

async function spawnAndCapture(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  stdin?: Buffer,
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "pipe" });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || `Python bridge exited with code ${code}`));
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

function joinPythonPath(existing: string | undefined, nextPath: string): string {
  if (!existing || existing.trim().length === 0) {
    return nextPath;
  }

  return `${nextPath}${path.delimiter}${existing}`;
}
