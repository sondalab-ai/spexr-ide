import { describe, expect, test } from "vitest";
import { basename, join } from "node:path";
import { configDirs, projectsDirOf } from "./config-dirs.js";

const HOME = "/home/u";
const DEFAULT = join(HOME, ".claude");

/** Discover against a fake home whose `.claude*` dirs each map to a has-projects flag. */
function cfg(env: NodeJS.ProcessEnv, entries: Record<string, boolean>) {
  return configDirs(env, {
    home: HOME,
    listHome: () => Object.keys(entries),
    hasProjects: (dir) => entries[basename(dir)] === true,
  });
}

describe("config-dirs", () => {
  test("default is ~/.claude when nothing else is discovered", () => {
    expect(cfg({}, {})).toEqual([DEFAULT]);
  });

  test("adaptively discovers a `.claude-perso` alias dir that has projects", () => {
    expect(cfg({}, { ".claude": true, ".claude-perso": true })).toEqual([
      DEFAULT,
      join(HOME, ".claude-perso"),
    ]);
  });

  test("ignores `.claude*` dirs without a projects subdir and unrelated dirs", () => {
    expect(cfg({}, { ".claude-backup": false, ".config": true })).toEqual([DEFAULT]);
  });

  test("adds CLAUDE_CONFIG_DIR when set, deduped against discovery", () => {
    expect(cfg({ CLAUDE_CONFIG_DIR: join(HOME, ".claude-perso") }, { ".claude-perso": true })).toEqual([
      DEFAULT,
      join(HOME, ".claude-perso"),
    ]);
  });

  test("dedupes when the override equals the default", () => {
    expect(cfg({ CLAUDE_CONFIG_DIR: DEFAULT }, {})).toEqual([DEFAULT]);
  });

  test("projectsDirOf appends /projects", () => {
    expect(projectsDirOf("/Users/x/.claude")).toBe("/Users/x/.claude/projects");
  });
});
