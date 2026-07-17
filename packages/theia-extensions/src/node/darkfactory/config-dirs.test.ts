import { describe, expect, test } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { configDirs, projectsDirOf } from "./config-dirs.js";

const DEFAULT = join(homedir(), ".claude");

describe("config-dirs", () => {
  test("default is ~/.claude when no env override", () => {
    expect(configDirs({})).toEqual([DEFAULT]);
  });

  test("adds CLAUDE_CONFIG_DIR when set", () => {
    expect(configDirs({ CLAUDE_CONFIG_DIR: "/Users/x/.claude-perso" })).toEqual([
      DEFAULT,
      "/Users/x/.claude-perso",
    ]);
  });

  test("dedupes when the override equals the default", () => {
    expect(configDirs({ CLAUDE_CONFIG_DIR: DEFAULT })).toEqual([DEFAULT]);
  });

  test("projectsDirOf appends /projects", () => {
    expect(projectsDirOf("/Users/x/.claude")).toBe("/Users/x/.claude/projects");
  });
});
