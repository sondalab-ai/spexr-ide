import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSessionNames,
  resolveSessionNamesPath,
  saveSessionNames,
} from "./session-names-store.js";

const dirs: string[] = [];

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "spexr-session-names-"));
  dirs.push(dir);
  return join(dir, "nested", "session-names.json");
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("resolveSessionNamesPath", () => {
  it("prefers the environment override so tests never touch the real home dir", () => {
    expect(resolveSessionNamesPath({ SPEXR_SESSION_NAMES: "/tmp/x.json" })).toBe("/tmp/x.json");
  });

  it("falls back to ~/.spexr/session-names.json, which is global, not per workspace", () => {
    expect(resolveSessionNamesPath({})).toMatch(/\.spexr[/\\]session-names\.json$/);
  });
});

describe("saveSessionNames / loadSessionNames", () => {
  it("creates missing directories and round-trips the names", async () => {
    const path = await tempPath();
    await saveSessionNames(new Map([["a", "Typography fix"]]), path);
    expect(loadSessionNamesEntries(await loadSessionNames(path))).toEqual([["a", "Typography fix"]]);
  });

  it("returns an empty map for a missing file", async () => {
    expect((await loadSessionNames(await tempPath())).size).toBe(0);
  });

  it("returns an empty map for unparseable content", async () => {
    const path = await tempPath();
    await saveSessionNames(new Map(), path);
    await writeFile(path, "{not json", "utf8");
    expect((await loadSessionNames(path)).size).toBe(0);
  });

  it("drops entries that are not strings, so a hand-edited file cannot poison a card", async () => {
    const path = await tempPath();
    await saveSessionNames(new Map(), path);
    await writeFile(path, JSON.stringify({ a: "ok", b: 7, c: null }), "utf8");
    expect(loadSessionNamesEntries(await loadSessionNames(path))).toEqual([["a", "ok"]]);
  });

  it("writes readable JSON keyed by session id", async () => {
    const path = await tempPath();
    await saveSessionNames(new Map([["a", "One"]]), path);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ a: "One" });
  });
});

function loadSessionNamesEntries(names: Map<string, string>): [string, string][] {
  return [...names.entries()].sort(([a], [b]) => a.localeCompare(b));
}
