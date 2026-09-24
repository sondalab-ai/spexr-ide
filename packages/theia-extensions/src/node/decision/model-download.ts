import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

const HUB = "https://huggingface.co";

/** Where models downloaded on first run live: the app bundle is signed and may be read-only. */
export function userModelsDir(): string {
  return join(homedir(), ".spexr", "models");
}

interface HubEntry {
  readonly type: string;
  readonly path: string;
  readonly size?: number;
}

/**
 * The files the decision worker loads from a kev repo: the config and
 * tokenizer files at the top level, and the q4 weights (graph plus external
 * data) under onnx/. The repo also carries other precisions, several GB each.
 */
export function modelFiles(tree: readonly HubEntry[]): string[] {
  return tree
    .filter((e) => e.type === "file")
    .map((e) => e.path)
    .filter((p) => (p.startsWith("onnx/") ? p.startsWith("onnx/model_q4.onnx") : p.endsWith(".json") || p.endsWith(".txt")));
}

export interface DownloadDeps {
  readonly fetch?: typeof fetch;
  readonly onProgress?: (received: number, total: number) => void;
  readonly signal?: AbortSignal;
}

/**
 * Downloads a model repo's q4 files into <root>/<repo>. Files land in a
 * sibling `.partial` folder that is renamed into place only once complete,
 * so an interrupted or failed download never leaves a model the worker would
 * try to load; the next attempt starts over.
 */
export async function downloadModel(repo: string, root: string, deps: DownloadDeps = {}): Promise<void> {
  const get = deps.fetch ?? fetch;
  const target = join(root, repo);
  const partial = `${target}.partial`;
  const opts = deps.signal ? { signal: deps.signal } : {};
  await rm(partial, { recursive: true, force: true });
  try {
    const listing = await get(`${HUB}/api/models/${repo}/tree/main?recursive=true`, opts);
    if (!listing.ok) throw new Error(`listing ${repo}: HTTP ${listing.status}`);
    const tree = (await listing.json()) as HubEntry[];
    const files = modelFiles(tree);
    const sizes = new Map(tree.map((e) => [e.path, e.size ?? 0]));
    const total = files.reduce((sum, f) => sum + (sizes.get(f) ?? 0), 0);
    let received = 0;
    for (const file of files) {
      const res = await get(`${HUB}/${repo}/resolve/main/${file}`, opts);
      if (!res.ok || !res.body) throw new Error(`${repo}/${file}: HTTP ${res.status}`);
      const out = join(partial, file);
      await mkdir(dirname(out), { recursive: true });
      const count = new Transform({
        transform(chunk: Buffer, _enc, done) {
          received += chunk.length;
          deps.onProgress?.(received, total);
          done(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as WebReadableStream), count, createWriteStream(out), opts);
    }
    await rm(target, { recursive: true, force: true });
    await rename(partial, target);
  } catch (err) {
    await rm(partial, { recursive: true, force: true });
    throw err;
  }
}
