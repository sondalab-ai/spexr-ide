import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadProjectNames,
  projectNameKey,
  resolveProjectNamesPath,
  saveProjectNames,
} from "./project-names-store.js";

const dirs: string[] = [];

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "spexr-project-names-"));
  dirs.push(dir);
  return join(dir, "nested", "project-names.json");
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("resolveProjectNamesPath", () => {
  it("prefers the environment override so tests never touch the real home dir", () => {
    expect(resolveProjectNamesPath({ SPEXR_PROJECT_NAMES: "/tmp/x.json" })).toBe("/tmp/x.json");
  });

  it("falls back to ~/.spexr/project-names.json, which is global, not per workspace", () => {
    expect(resolveProjectNamesPath({})).toMatch(/\.spexr[/\\]project-names\.json$/);
  });
});

describe("projectNameKey", () => {
  it("treats a trailing slash as the same project", () => {
    expect(projectNameKey("/src/spexr/")).toBe(projectNameKey("/src/spexr"));
  });

  it("keeps the root path rather than collapsing it to nothing", () => {
    expect(projectNameKey("/")).toBe("/");
  });
});

describe("saveProjectNames / loadProjectNames", () => {
  it("creates missing directories and round-trips the names", async () => {
    const path = await tempPath();
    await saveProjectNames(new Map([["/src/spexr", "Wall"]]), path);
    expect(entries(await loadProjectNames(path))).toEqual([["/src/spexr", "Wall"]]);
  });

  it("returns an empty map for a missing file", async () => {
    expect((await loadProjectNames(await tempPath())).size).toBe(0);
  });

  it("returns an empty map for unparseable content", async () => {
    const path = await tempPath();
    await saveProjectNames(new Map(), path);
    await writeFile(path, "{not json", "utf8");
    expect((await loadProjectNames(path)).size).toBe(0);
  });

  it("drops entries that are not strings, so a hand-edited file cannot poison a header", async () => {
    const path = await tempPath();
    await saveProjectNames(new Map(), path);
    await writeFile(path, JSON.stringify({ "/a": "ok", "/b": 7, "/c": null }), "utf8");
    expect(entries(await loadProjectNames(path))).toEqual([["/a", "ok"]]);
  });

  it("normalizes hand-edited keys, so a trailing slash still finds the name", async () => {
    const path = await tempPath();
    await saveProjectNames(new Map(), path);
    await writeFile(path, JSON.stringify({ "/src/spexr/": "Wall" }), "utf8");
    expect((await loadProjectNames(path)).get("/src/spexr")).toBe("Wall");
  });

  it("writes readable JSON keyed by project path", async () => {
    const path = await tempPath();
    await saveProjectNames(new Map([["/src/spexr", "Wall"]]), path);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ "/src/spexr": "Wall" });
  });
});

function entries(names: Map<string, string>): [string, string][] {
  return [...names.entries()].sort(([a], [b]) => a.localeCompare(b));
}
