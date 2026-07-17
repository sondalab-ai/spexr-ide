import { describe, expect, test } from "vitest";
import { parseClaudePids, parseCwd, liveProjectDirs } from "./process-scanner.js";

describe("process-scanner", () => {
  test("parseClaudePids keeps pids whose comm is exactly 'claude'", () => {
    const ps = ["  PID COMM", " 2098 claude", " 2175 node", " 2624 claude"].join("\n");
    expect(parseClaudePids(ps)).toEqual([2098, 2624]);
  });

  test("parseCwd reads the n-prefixed cwd line from lsof -Fn", () => {
    expect(parseCwd("p2098\nfcwd\nn/Users/x/src/proj\n")).toBe("/Users/x/src/proj");
    expect(parseCwd("p2098\nfcwd\n")).toBeUndefined();
  });

  test("liveProjectDirs returns the set of claude cwds", async () => {
    const set = await liveProjectDirs({
      runPs: () => Promise.resolve(" PID COMM\n 10 claude\n 11 claude\n"),
      runLsofCwd: (pid) => Promise.resolve(`p${pid}\nfcwd\nn/proj/${pid}\n`),
    });
    expect(set).toEqual(new Set(["/proj/10", "/proj/11"]));
  });

  test("liveProjectDirs returns null when ps fails", async () => {
    const set = await liveProjectDirs({
      runPs: () => Promise.reject(new Error("no ps")),
      runLsofCwd: async () => "",
    });
    expect(set).toBeNull();
  });
});
