import { describe, expect, test } from "vitest";
import { buildProjectTargets, normalizeProjectPath, type SessionOrigin } from "./project-switch-targets.js";

const session = (projectPath: string, lastActivityMs: number, projectName = ""): SessionOrigin => ({
  projectPath,
  projectName,
  lastActivityMs,
});

describe("buildProjectTargets", () => {
  test("lists projects with sessions first, most recently active first", () => {
    const targets = buildProjectTargets(
      ["/home/me/old"],
      [session("/home/me/quiet", 100), session("/home/me/busy", 900)],
    );
    expect(targets.map((t) => t.path)).toEqual(["/home/me/busy", "/home/me/quiet", "/home/me/old"]);
  });

  test("collapses several sessions of one project into a single target", () => {
    const [target] = buildProjectTargets(
      [],
      [session("/home/me/app", 100), session("/home/me/app", 700), session("/home/me/app", 400)],
    );
    expect(target).toMatchObject({ path: "/home/me/app", sessions: 3, lastActivityMs: 700 });
  });

  test("excludes the loaded project from both sources", () => {
    const targets = buildProjectTargets(
      ["/home/me/app", "/home/me/other"],
      [session("/home/me/app", 900)],
      "/home/me/app",
    );
    expect(targets.map((t) => t.path)).toEqual(["/home/me/other"]);
  });

  test("keeps a recent workspace out of the list when it already has a session", () => {
    const targets = buildProjectTargets(["/home/me/app"], [session("/home/me/app", 900)]);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ path: "/home/me/app", sessions: 1 });
  });

  test("matches paths that differ only by a trailing slash", () => {
    const targets = buildProjectTargets(["/home/me/app/"], [session("/home/me/app", 900)], "/home/me/other/");
    expect(targets.map((t) => t.path)).toEqual(["/home/me/app"]);
  });

  test("names a target from the session, falling back to the last path segment", () => {
    const targets = buildProjectTargets(["/home/me/from-recents"], [session("/home/me/app", 1, "Nice Name")]);
    expect(targets.map((t) => t.name)).toEqual(["Nice Name", "from-recents"]);
  });

  test("skips blank paths rather than emitting an unusable target", () => {
    const targets = buildProjectTargets(["", "  "], [session("", 900)]);
    expect(targets).toEqual([]);
  });

  test("preserves the order recent workspaces arrive in", () => {
    const targets = buildProjectTargets(["/a", "/b", "/c"], []);
    expect(targets.map((t) => t.path)).toEqual(["/a", "/b", "/c"]);
  });
});

describe("normalizeProjectPath", () => {
  test("drops trailing slashes and surrounding whitespace", () => {
    expect(normalizeProjectPath(" /home/me/app// ")).toBe("/home/me/app");
  });

  test("leaves the filesystem root usable", () => {
    expect(normalizeProjectPath("/")).toBe("/");
  });
});
