import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectGroups } from "./project-group.js";

let home: string;
let scratch: string;
beforeEach(async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "groups-")));
  home = join(base, "home");
  scratch = join(base, "tmp");
  await mkdir(home, { recursive: true });
  await mkdir(scratch, { recursive: true });
});
afterEach(async () => {
  await rm(join(home, ".."), { recursive: true, force: true });
});

async function dir(...parts: string[]): Promise<string> {
  const path = join(home, ...parts);
  await mkdir(path, { recursive: true });
  return path;
}

function groups(now = () => 0) {
  return new ProjectGroups(now, home, scratch);
}

describe("ProjectGroups", () => {
  it("puts a session that moved into a subfolder with its repository", async () => {
    const repo = await dir("src", "spexr");
    await mkdir(join(repo, ".git"));
    const pkg = await dir("src", "spexr", "packages", "ext");
    await writeFile(join(pkg, "package.json"), "{}");
    expect(await groups().resolve(pkg)).toEqual({ path: repo });
  });

  it("puts a linked worktree with the main checkout its .git file points to", async () => {
    const repo = await dir("src", "hub");
    await mkdir(join(repo, ".git", "worktrees", "wt-perf"), { recursive: true });
    const wt = await dir("src", "hub-wt-perf");
    await writeFile(join(wt, ".git"), `gitdir: ${join(repo, ".git", "worktrees", "wt-perf")}\n`);
    expect(await groups().resolve(join(wt, ""))).toEqual({ path: repo });
  });

  it("puts a removed Claude Code worktree with its repository", async () => {
    const repo = await dir("src", "hub");
    await mkdir(join(repo, ".git"));
    expect(await groups().resolve(join(repo, ".claude", "worktrees", "gone", "e2e"))).toEqual({ path: repo });
  });

  it("keeps a submodule as its own project", async () => {
    const sub = await dir("src", "app", "vendor", "lib");
    await mkdir(join(home, "src", "app", ".git"));
    await writeFile(join(sub, ".git"), "gitdir: ../../.git/modules/lib\n");
    expect(await groups().resolve(sub)).toEqual({ path: sub });
  });

  it("uses the nearest project file when there is no repository", async () => {
    const proj = await dir("src", "draft");
    await writeFile(join(proj, "CLAUDE.md"), "");
    const deep = await dir("src", "draft", "notes", "a");
    expect(await groups().resolve(deep)).toEqual({ path: proj });
  });

  it("never lets a container folder or the home directory absorb the projects below", async () => {
    await writeFile(join(home, "CLAUDE.md"), "");
    await mkdir(join(home, ".git"));
    const loose = await dir("src", "loose", "sub");
    expect(await groups().resolve(loose)).toEqual({ path: loose });
    expect(await groups().resolve(join(home, "src"))).toEqual({ path: join(home, "src") });
  });

  it("puts every temp-directory session in one scratch group", async () => {
    const probe = join(scratch, "spexr-probe-abc");
    await mkdir(probe);
    expect(await groups().resolve(probe)).toEqual({ path: scratch, scratch: true });
  });

  it("regroups a subfolder under its project once the project is initialised", async () => {
    let now = 0;
    const g = groups(() => now);
    const proj = await dir("src", "fresh");
    const sub = await dir("src", "fresh", "src");
    expect(await g.resolve(sub)).toEqual({ path: sub });
    await mkdir(join(proj, ".git"));
    now = 30_000;
    expect(await g.resolve(sub)).toEqual({ path: sub }); // the answer holds a minute
    now = 61_000;
    expect(await g.resolve(sub)).toEqual({ path: proj });
  });
});
