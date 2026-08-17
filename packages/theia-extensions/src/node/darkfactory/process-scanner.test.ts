import { describe, expect, test } from "vitest";
import { parseClaudePids, parseAgentPids, parseCwd, liveProjectDirs, lsofCwdArgs } from "./process-scanner.js";

describe("process-scanner", () => {
  test("lsofCwdArgs ANDs the pid and cwd selectors with -a (else lsof ORs → cwd '/')", () => {
    expect(lsofCwdArgs(2098)).toEqual(["-a", "-p", "2098", "-d", "cwd", "-Fn"]);
  });

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

describe("parseAgentPids", () => {
  const ps = ["  10 claude", "  20 opencode", "  30 node", "  40 claude"].join("\n");

  test("matches a single name (claude) like the legacy parser", () => {
    expect(parseAgentPids(ps, ["claude"])).toEqual([10, 40]);
  });

  test("matches multiple names (claude + opencode)", () => {
    expect(parseAgentPids(ps, ["claude", "opencode"])).toEqual([10, 20, 40]);
  });

  test("no name matches → empty", () => {
    expect(parseAgentPids(ps, ["ghost"])).toEqual([]);
  });
});
