import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { downloadModel, modelFiles } from "./model-download.js";

const REPO = "onnx-community/kev-0.6b-ONNX";

const TREE = [
  { type: "file", path: ".gitattributes", size: 1 },
  { type: "file", path: "README.md", size: 1 },
  { type: "file", path: "config.json", size: 2 },
  { type: "file", path: "tokenizer.json", size: 3 },
  { type: "directory", path: "onnx", size: 0 },
  { type: "file", path: "onnx/model_q4.onnx", size: 4 },
  { type: "file", path: "onnx/model_q4.onnx_data", size: 5 },
  { type: "file", path: "onnx/model_q4f16.onnx", size: 6 },
  { type: "file", path: "onnx/model_q4f16.onnx_data", size: 7 },
];

/** A fetch serving TREE from the listing API and each file's path as its body. */
function fakeHub(fail?: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/api/models/")) return new Response(JSON.stringify(TREE));
    const path = url.split("/resolve/main/")[1]!;
    if (path === fail) return new Response("nope", { status: 500 });
    return new Response(path);
  }) as typeof fetch;
}

describe("modelFiles", () => {
  it("keeps the config, the tokenizer and the q4 weights, and skips the rest", () => {
    expect(modelFiles(TREE)).toEqual(["config.json", "tokenizer.json", "onnx/model_q4.onnx", "onnx/model_q4.onnx_data"]);
  });
});

describe("downloadModel", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "spexr-model-download-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lands every file under <root>/<repo>, reporting progress", async () => {
    const seen: number[] = [];
    await downloadModel(REPO, root, { fetch: fakeHub(), onProgress: (received) => seen.push(received) });
    expect(await readFile(join(root, REPO, "onnx/model_q4.onnx_data"), "utf8")).toBe("onnx/model_q4.onnx_data");
    expect(await readFile(join(root, REPO, "config.json"), "utf8")).toBe("config.json");
    expect(seen.at(-1)).toBeGreaterThan(0);
    expect(await readdir(join(root, "onnx-community"))).toEqual(["kev-0.6b-ONNX"]);
  });

  it("leaves nothing behind when a file fails, so a half model is never loaded", async () => {
    await expect(downloadModel(REPO, root, { fetch: fakeHub("onnx/model_q4.onnx_data") })).rejects.toThrow(/500/);
    expect(await readdir(join(root, "onnx-community"))).toEqual([]);
  });

  it("clears a download left by a process that died, but not one still running", async () => {
    const dead = join(root, `${REPO}.partial-999999999-dead`);
    const live = join(root, `${REPO}.partial-${process.pid}-live`);
    for (const dir of [dead, live]) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "stale.bin"), "x");
    }
    await downloadModel(REPO, root, { fetch: fakeHub() });
    expect((await readdir(join(root, "onnx-community"))).sort()).toEqual(["kev-0.6b-ONNX", "kev-0.6b-ONNX.partial-" + process.pid + "-live"]);
  });

  it("lets two downloads of the same model run at once: one lands, the other steps aside", async () => {
    await Promise.all([downloadModel(REPO, root, { fetch: fakeHub() }), downloadModel(REPO, root, { fetch: fakeHub() })]);
    expect(await readdir(join(root, "onnx-community"))).toEqual(["kev-0.6b-ONNX"]);
    expect(await readFile(join(root, REPO, "onnx/model_q4.onnx_data"), "utf8")).toBe("onnx/model_q4.onnx_data");
  });

  it("stops and cleans up when aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(downloadModel(REPO, root, { fetch: fakeHub(), signal: abort.signal })).rejects.toThrow();
    expect(await readdir(join(root, "onnx-community")).catch(() => [])).toEqual([]);
  });
});
