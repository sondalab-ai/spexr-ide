import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionIndex, SESSION_INDEX_VERSION } from "./session-index.js";
import {
  loadSessionIndex,
  resolveSessionIndexPath,
  saveSessionIndex,
} from "./session-index-store.js";

const dirs: string[] = [];

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "spexr-session-index-"));
  dirs.push(dir);
  return join(dir, "nested", "sessions-index.json");
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("resolveSessionIndexPath", () => {
  it("prefers the environment override so tests never touch the real home dir", () => {
    expect(resolveSessionIndexPath({ SPEXR_SESSION_INDEX: "/tmp/x.json" })).toBe("/tmp/x.json");
  });

  it("falls back to ~/.spexr/sessions-index.json, which is global, not per workspace", () => {
    expect(resolveSessionIndexPath({})).toMatch(/\.spexr[/\\]sessions-index\.json$/);
  });
});

describe("saveSessionIndex / loadSessionIndex", () => {
  it("creates missing directories and round-trips the index", async () => {
    const path = await tempPath();
    const index = new SessionIndex();
    index.upsert({
      sessionId: "a",
      harness: "claude",
      projectPath: "/p",
      projectName: "p",
      transcriptPath: "/t/a.jsonl",
      configDir: "/c",
      mtimeMs: 7,
      docHash: "h",
      vector: Float32Array.from([1, 0]),
      goal: "g",
      doc: "design system effects",
    });
    await saveSessionIndex(index, path);
    const restored = await loadSessionIndex(path);
    expect(restored.get("a")!.mtimeMs).toBe(7);
    expect([...restored.bm25.score("effects").keys()]).toEqual(["a"]);
  });

  it("returns an empty index for a missing file", async () => {
    expect((await loadSessionIndex(await tempPath())).size).toBe(0);
  });

  it("returns an empty index for unparseable content or a foreign version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spexr-session-index-"));
    dirs.push(dir);
    const broken = join(dir, "broken.json");
    await writeFile(broken, "{not json", "utf8");
    expect((await loadSessionIndex(broken)).size).toBe(0);

    const foreign = join(dir, "foreign.json");
    await writeFile(
      foreign,
      JSON.stringify({ version: SESSION_INDEX_VERSION + 1, records: [] }),
      "utf8",
    );
    expect((await loadSessionIndex(foreign)).size).toBe(0);
  });
});
