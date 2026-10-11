import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFixture, type FixtureReport, type FixtureState } from "../../../../../tests/visual/checks";
import { transcriptPath, type PreparedRun } from "../../../../../tests/visual/prepare";
import { probeProcesses } from "../../../../../tests/visual/stubs";
import { configDirs, projectsDirOf } from "./config-dirs.js";

/**
 * The parity capture's own assertions, held in a test that runs in the unit
 * job: the capture itself runs only on a runner, so a branch of `checkFixture`
 * that never fires would otherwise go unnoticed until a run needs it.
 */
const STATE: FixtureState = {
  agentsPill: "2 agents running",
  bellDot: true,
  toasts: 0,
  dirtyTabs: ["resolve.ts M, 1", "evidence.ts U"],
  statusProblems: { errors: 0, warnings: 2 },
};
const REPORT: FixtureReport = {
  base: { problems: 2, dirty: ["resolve.ts", "evidence.ts"] },
  pnpm: { "test-probe": 0, "sl-audit": 1 },
  processes: {
    pids: [10, 11],
    dirs: ["/w/probe-engine", "/w/prism-site"],
    psClaude: ["10 claude", "11 claude"],
    cwd: { "10": "/w/probe-engine", "11": "/w/prism-site" },
  },
};

describe("checkFixture", () => {
  it("passes a fixture that loaded", () => {
    expect(checkFixture(STATE, REPORT)).toEqual([]);
  });

  const cases: Array<[string, FixtureState, FixtureReport, string]> = [
    ["the pill", { ...STATE, agentsPill: "1 agent running" }, REPORT, "agents pill"],
    ["no pill", { ...STATE, agentsPill: null }, REPORT, "agents pill"],
    ["the bell dot", { ...STATE, bellDot: false }, REPORT, "bell has no dot"],
    ["a toast", { ...STATE, toasts: 1 }, REPORT, "toast"],
    ["the status bar's count", { ...STATE, statusProblems: { errors: 0, warnings: 1 } }, REPORT, "status bar"],
    ["an unreadable status bar", { ...STATE, statusProblems: null }, REPORT, "status bar"],
    ["a clean tab", { ...STATE, dirtyTabs: ["resolve.ts M, 1"] }, REPORT, "evidence.ts carries the dirty class"],
    ["the problem count", STATE, { ...REPORT, base: { ...REPORT.base, problems: 1 } }, "1 problems"],
    ["an unsaved file", STATE, { ...REPORT, base: { problems: 2, dirty: ["resolve.ts"] } }, "evidence.ts is not unsaved"],
    ["the test exit", STATE, { ...REPORT, pnpm: { "test-probe": 1, "sl-audit": 1 } }, "pnpm test probe recorded exit 1"],
    ["the audit exit", STATE, { ...REPORT, pnpm: { "test-probe": 0 } }, "pnpm sl-audit recorded exit undefined"],
    ["no process probe", STATE, { ...REPORT, processes: undefined as never }, "no process probe"],
    ["a stub ps misses", STATE, { ...REPORT, processes: { ...REPORT.processes!, psClaude: ["10 claude"] } }, "ps does not list stub 11"],
    ["a stub in the wrong directory", STATE, { ...REPORT, processes: { ...REPORT.processes!, cwd: { "10": "/w/probe-engine", "11": "/" } } }, "no stub has cwd /w/prism-site"],
  ];
  it.each(cases)("fails on %s", (_name, state, report, expected) => {
    expect(checkFixture(state, report).join("\n")).toContain(expected);
  });
});

describe("probeProcesses", () => {
  const ps = ["  PID COMM", "10 claude", "11 claude", "12 /bin/sh", "13 claude-helper", "14 /usr/bin/claude"].join("\n");

  it("lists only the commands named exactly claude, and each stub's cwd", () => {
    const run = (cmd: string, args: string[]): string => (cmd === "ps" ? ps : `p${args[2]}\nfcwd\nn/w/dir${args[2]}\n`);
    expect(probeProcesses(run, [10, 11])).toEqual({ psClaude: ["10 claude", "11 claude"], cwd: { "10": "/w/dir10", "11": "/w/dir11" }, lsof: true });
  });

  it("says so when lsof is missing, and keeps the rest", () => {
    const run = (cmd: string): string => {
      if (cmd === "ps") return ps;
      throw new Error("spawn lsof ENOENT");
    };
    expect(probeProcesses(run, [10])).toEqual({ psClaude: ["10 claude", "11 claude"], cwd: { "10": null }, lsof: false });
  });

  it("reports a failing ps as an error with nothing found", () => {
    const run = (): string => {
      throw new Error("no ps");
    };
    const probe = probeProcesses(run, [10]);
    expect(probe.psClaude).toEqual([]);
    expect(probe.lsof).toBe(false);
    expect(probe.error).toContain("no ps");
  });
});

describe("where the fixture puts a transcript", () => {
  // The workspace folder must exist for its real path; the test's own is one.
  const home = "/run/home";
  const run = { home, workspace: process.cwd(), site: process.cwd() } as PreparedRun;
  const session = { file: "x.jsonl", project: "ws", sessionId: "abc", name: "n", ageMinutes: 0, live: true, tools: 1 } as const;

  it("is under the projects directory the backend reads for the default account", () => {
    const file = transcriptPath(run, session);
    expect(configDirs({}, { home, listHome: () => [], hasProjects: () => false })).toContain(join(home, ".claude"));
    expect(dirname(dirname(file))).toBe(projectsDirOf(join(home, ".claude")));
    expect(file.endsWith("/abc.jsonl")).toBe(true);
  });

  it("names the project folder as Claude does: every character that is not a letter or digit becomes a dash", () => {
    expect(dirname(transcriptPath(run, session)).split("/").pop()).toBe(process.cwd().replace(/[^a-zA-Z0-9]/g, "-"));
  });
});
