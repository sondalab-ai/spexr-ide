import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadSchedules, resolveSchedulesPath, saveSchedules, type ScheduleFile } from "./schedule-store.js";

const dirs: string[] = [];
async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "spexr-schedules-"));
  dirs.push(dir);
  return join(dir, "nested", "schedules.json");
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const file: ScheduleFile = {
  version: 1,
  schedules: [{ id: "s", name: "S", tasks: [] }],
  runs: {},
};

describe("resolveSchedulesPath", () => {
  it("prefers SPEXR_SCHEDULES", () => {
    expect(resolveSchedulesPath({ SPEXR_SCHEDULES: "/tmp/x.json" })).toBe("/tmp/x.json");
  });
  it("falls back to ~/.spexr/schedules.json", () => {
    expect(resolveSchedulesPath({})).toMatch(/\.spexr[/\\]schedules\.json$/);
  });
});

describe("loadSchedules / saveSchedules", () => {
  it("starts empty when there is no file", async () => {
    expect(await loadSchedules(await tempPath())).toEqual({ version: 1, schedules: [], runs: {} });
  });
  it("round-trips through an atomic write, leaving no temporary file", async () => {
    const path = await tempPath();
    await saveSchedules(file, path);
    expect(await loadSchedules(path)).toEqual(file);
    expect((await readdir(dirname(path))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
  it("moves a damaged file aside instead of letting the next save erase it", async () => {
    const path = await tempPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{ not json", "utf8");
    expect(await loadSchedules(path)).toEqual({ version: 1, schedules: [], runs: {} });
    const kept = (await readdir(dirname(path))).find((f) => f.startsWith("schedules.json.damaged-"));
    expect(kept).toBeDefined();
    expect(await readFile(join(dirname(path), kept!), "utf8")).toBe("{ not json");
  });
  it("treats a file of the wrong shape as damaged too", async () => {
    const path = await tempPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 1, schedules: "nope" }), "utf8");
    expect((await loadSchedules(path)).schedules).toEqual([]);
    expect((await readdir(dirname(path))).some((f) => f.startsWith("schedules.json.damaged-"))).toBe(true);
  });
});
