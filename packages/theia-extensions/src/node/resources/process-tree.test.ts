import { describe, expect, it } from "vitest";
import { parseCpuTime, parsePs, summarizeTree, type ProcessRow } from "./process-tree.js";

describe("parseCpuTime", () => {
  it("reads macOS minutes:seconds with hundredths", () => {
    expect(parseCpuTime("0:01.50")).toBeCloseTo(1.5);
    expect(parseCpuTime("12:03.25")).toBeCloseTo(723.25);
  });

  it("reads Linux hours:minutes:seconds and a day prefix", () => {
    expect(parseCpuTime("01:00:02")).toBe(3602);
    expect(parseCpuTime("2-00:00:01")).toBe(2 * 86400 + 1);
  });

  it("reads an unparseable time as zero", () => {
    expect(parseCpuTime("-")).toBe(0);
  });
});

describe("parsePs", () => {
  it("parses pid, ppid, rss in KiB, cpu time and the full command line", () => {
    const rows = parsePs(
      "  PID  PPID   RSS      TIME ARGS\n" +
        "  100     1 20480   0:02.00 /Applications/SPEXR.app/Contents/MacOS/SPEXR --flag\n" +
        "  101   100  1024   0:00.50 node /x/lib/node/search/description-worker.js\n" +
        "garbage\n",
    );
    expect(rows).toEqual([
      { pid: 100, ppid: 1, rssBytes: 20480 * 1024, cpuSeconds: 2, args: "/Applications/SPEXR.app/Contents/MacOS/SPEXR --flag" },
      { pid: 101, ppid: 100, rssBytes: 1024 * 1024, cpuSeconds: 0.5, args: "node /x/lib/node/search/description-worker.js" },
    ]);
  });
});

function row(pid: number, ppid: number, mb: number, cpuSeconds: number, args = "proc"): ProcessRow {
  return { pid, ppid, rssBytes: mb * 1024 * 1024, cpuSeconds, args };
}

describe("summarizeTree", () => {
  // 10 Electron main, 11 renderer, 20 backend, 21 model worker, 30 shell, 31 agent under it; 99 unrelated.
  const rows = [
    row(1, 0, 0, 0),
    row(10, 1, 100, 10),
    row(11, 10, 200, 20),
    row(20, 10, 50, 5),
    row(21, 20, 300, 30, "node /x/lib/node/decision/decision-worker.js"),
    row(30, 20, 5, 1, "-zsh"),
    row(31, 30, 400, 40, "claude"),
    row(99, 1, 999, 99),
  ];

  it("splits the tree into app, models and terminals and leaves other processes out", () => {
    const usage = summarizeTree(rows, { rootPid: 10, backendPid: 20 }, new Map(), 1);
    const mb = (g: { rssBytes: number }) => g.rssBytes / 1024 / 1024;
    expect(mb(usage.app)).toBe(350);
    expect(mb(usage.models)).toBe(300);
    expect(mb(usage.terminals)).toBe(405);
    expect(mb(usage.total)).toBe(1055);
    expect([usage.app.processes, usage.models.processes, usage.terminals.processes, usage.total.processes]).toEqual([3, 1, 2, 6]);
  });

  it("measures CPU as the time used since the previous sample, per core", () => {
    const previous = new Map([[10, 9], [11, 19], [21, 28], [31, 38]]);
    const usage = summarizeTree(rows, { rootPid: 10, backendPid: 20 }, previous, 2);
    // app: (1 + 1 + 0 for the unseen backend) / 2s; models: 2/2; terminals: 0 for the unseen shell + 2/2.
    expect(usage.app.cpuPercent).toBeCloseTo(100);
    expect(usage.models.cpuPercent).toBeCloseTo(100);
    expect(usage.terminals.cpuPercent).toBeCloseTo(100);
    expect(usage.total.cpuPercent).toBeCloseTo(300);
  });

  it("counts Theia's helpers under the backend as the app", () => {
    const withHelper = [...rows, row(22, 20, 70, 0, "Electron Helper /x/node_modules/@theia/plugin-ext/lib/hosted/node/plugin-host")];
    const usage = summarizeTree(withHelper, { rootPid: 10, backendPid: 20 }, new Map(), 1);
    expect(usage.app.processes).toBe(4);
    expect(usage.terminals.processes).toBe(2);
  });

  it("never reports negative CPU when a pid was reused", () => {
    const usage = summarizeTree(rows, { rootPid: 10, backendPid: 20 }, new Map([[31, 500]]), 1);
    expect(usage.terminals.cpuPercent).toBe(0);
  });

  it("counts only the backend when it is its own root", () => {
    const usage = summarizeTree(rows, { rootPid: 20, backendPid: 20 }, new Map(), 1);
    expect(usage.app.processes).toBe(1);
    expect(usage.total.processes).toBe(4);
  });
});
