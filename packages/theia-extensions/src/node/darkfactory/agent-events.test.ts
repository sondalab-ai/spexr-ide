import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAgentPaneSnapshot, diffSnapshots, parseCheckboxes, tokPerSecOf, type PaneEntry } from "./agent-events.js";

/** The S6a fixture's transcripts, with the workspace paths filled in. */
const DIR = fileURLToPath(new URL("../../../../../tests/visual/fixtures/claude-sessions/", import.meta.url));
const WS = "/run/ws/probe-engine";
const SITE = "/run/ws/prism-site";
const load = (file: string): PaneEntry[] =>
  readFileSync(DIR + file, "utf8")
    .split("{{WS}}")
    .join(WS)
    .split("{{SITE}}")
    .join(SITE)
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PaneEntry);

const refactor = load("refactor-the-audit.jsonl");
const snap = buildAgentPaneSnapshot(refactor, { sessionId: "8f2a4c1e", title: "Refactor the audit", state: "working", needsYou: false });

// Small hand-built transcripts for the cases the fixture does not hold.
let clock = Date.parse("2026-10-09T10:00:00Z");
const at = (ms: number): string => new Date((clock += ms)).toISOString();
const prompt = (text: string): PaneEntry => ({ timestamp: at(1000), message: { role: "user", content: text } });
const call = (id: string, name: string, input: unknown, msgId = `m-${id}`): PaneEntry => ({
  timestamp: at(500),
  message: { id: msgId, role: "assistant", model: "claude-opus-5-5", content: [{ type: "tool_use", id, name, input }], usage: { output_tokens: 100 } },
});
const result = (id: string, text = "ok", extra?: unknown, isError = false): PaneEntry => ({
  timestamp: at(200),
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }] },
  ...(extra !== undefined ? { toolUseResult: extra } : {}),
});

describe("buildAgentPaneSnapshot on the parity fixture", () => {
  it("heads the turn with the genuine prompt and the model", () => {
    expect(snap.turn?.prompt).toBe("Make cache.write awaited and keep the p95 under 2 ms. Show me the evidence.");
    expect(snap.model).toBe("claude-opus-5-5");
    expect(snap.title).toBe("Refactor the audit");
    expect(snap.state).toBe("working");
  });

  it("pairs every call with its result by id; only the audit has none and is running", () => {
    const tools = snap.turn!.tools!;
    expect(tools.length).toBe(11); // 14 calls, less the 3 TodoWrite calls
    const running = tools.filter((t) => t.state === "run");
    expect(running.map((t) => [t.verb, t.target])).toEqual([["Run", "pnpm sl-audit"]]);
    expect(tools.filter((t) => t.state === "error").map((t) => t.target)).toEqual(['rg -n "P95_BUDGET_MS" src']);
    expect(tools.filter((t) => t.state === "done").length).toBe(9);
    expect(new Set(tools.map((t) => t.id)).size).toBe(tools.length);
  });

  it("counts every call, plan tools included", () => {
    expect(snap.toolCount).toBe(14);
  });

  it("times a tool from its call to its result", () => {
    const byTarget = (t: string) => snap.turn!.tools!.find((x) => x.target === t)!;
    expect(byTarget("pnpm test probe").durationMs).toBe(2400);
    expect(snap.turn!.tools!.find((x) => x.verb === "Edit" && x.target === "resolve.ts")!.durationMs).toBe(1100);
    expect(snap.turn!.tools!.find((x) => x.verb === "Read" && x.target === "cache.ts")!.durationMs).toBe(200);
    expect(snap.turn!.tools!.find((x) => x.state === "run")!.durationMs).toBeUndefined();
  });

  it("gives an Edit its +14 -3 and builds the diff from the latest one, capped at six lines", () => {
    const edit = snap.turn!.tools!.find((x) => x.target === "resolve.ts" && x.verb === "Edit")!;
    expect([edit.added, edit.removed]).toEqual([14, 3]);
    expect(snap.turn!.diff).toMatchObject({ file: "resolve.ts", added: 14, removed: 3 });
    expect(snap.turn!.diff!.lines).toHaveLength(6);
    expect(snap.turn!.diff!.lines![0]).toBe("-  const answer = await probe.run({ evidence, timeout: 14_000 });");
    expect(snap.turn!.diff!.lines!.every((l) => l.startsWith("+") || l.startsWith("-"))).toBe(true);
  });

  it("reads the plan from TodoWrite: two of three completed", () => {
    expect(snap.planSource).toBe("todo");
    expect(snap.plan).toEqual([
      { text: "Await the write", done: true },
      { text: "Re-run the probe suite", done: true },
      { text: "Fix the R finding", done: false },
    ]);
  });

  it("reads about 1.2k tokens a second off the last response", () => {
    expect(snap.tokPerSec).toBeGreaterThan(1150);
    expect(snap.tokPerSec).toBeLessThan(1250);
  });

  it("reads the permission mode from the standalone record", () => {
    expect(snap.permissionMode).toBe("auto");
    expect(snap.planMode).toBe(false);
  });

  it("keeps the prose of the turn", () => {
    expect(snap.turn!.prose![0]).toBe("Found it: the write races the return. I'll await it and measure.");
    expect(snap.turn!.prose!.length).toBeLessThanOrEqual(6);
  });
});

describe("the other fixture sessions", () => {
  it("counts 212 and 58 calls, and 198 for the running prism-site agent, which has one open", () => {
    const counts = ["prism-light-theme.jsonl", "edge-in-shade.jsonl", "prism-site-rebuild.jsonl"].map((f) => buildAgentPaneSnapshot(load(f), { sessionId: f }));
    expect(counts.map((s) => s.toolCount)).toEqual([212, 58, 198]);
    expect(counts[2]!.turn!.tools!.filter((t) => t.state === "run")).toHaveLength(1);
    expect(counts[0]!.turn!.tools!.filter((t) => t.state === "run")).toHaveLength(0);
  });
});

describe("tolerance", () => {
  it("returns just the id for nothing, and survives entries of unknown shape", () => {
    expect(buildAgentPaneSnapshot([], { sessionId: "x" })).toEqual({ sessionId: "x" });
    const odd = [{}, { message: {} }, { message: { role: "assistant", content: "text" } }, { message: { role: "user", content: [null, 3, "x"] } }, { type: "mystery", toolUseResult: 7 }] as unknown as PaneEntry[];
    expect(() => buildAgentPaneSnapshot(odd, { sessionId: "x" })).not.toThrow();
  });

  it("does not need originalFile or structuredPatch on an Edit result", () => {
    const entries = [prompt("go"), call("t1", "Edit", { file_path: "/a/b.ts" }), result("t1", "updated", { filePath: "/a/b.ts" })];
    const s = buildAgentPaneSnapshot(entries, { sessionId: "x" });
    expect(s.turn!.tools).toEqual([{ id: "t1", name: "Edit", verb: "Edit", target: "b.ts", state: "done", durationMs: 200 }]);
    expect(s.turn!.diff).toBeUndefined();
  });

  it("reads the permission mode from a user entry too, and the later one wins", () => {
    const entries: PaneEntry[] = [
      { type: "permission-mode", permissionMode: "default" },
      { timestamp: at(1), message: { role: "user", content: "hi" }, permissionMode: "plan" },
    ];
    expect(buildAgentPaneSnapshot(entries, { sessionId: "x" })).toMatchObject({ permissionMode: "plan", planMode: true });
  });

  it("marks a call the user interrupted as an error, not running", () => {
    const entries: PaneEntry[] = [prompt("go"), call("t1", "Bash", { command: "sleep 99" }), { message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } }];
    expect(buildAgentPaneSnapshot(entries, { sessionId: "x" }).turn!.tools![0]!.state).toBe("error");
  });

  it("starts the turn at the latest genuine prompt, not at a tool result or an injected one", () => {
    const entries = [prompt("first"), call("t1", "Read", { file_path: "/a" }), result("t1"), { isMeta: true, message: { role: "user", content: "<reminder>" } } as PaneEntry, prompt("second"), call("t2", "Read", { file_path: "/b" })];
    const s = buildAgentPaneSnapshot(entries, { sessionId: "x" });
    expect(s.turn!.prompt).toBe("second");
    expect(s.turn!.tools!.map((t) => t.id)).toEqual(["t2"]);
    expect(s.toolCount).toBe(2);
  });
});

describe("the plan chain", () => {
  const todo = call("a", "TodoWrite", { todos: [{ content: "T1", status: "completed" }, { content: "T2", status: "in_progress" }] });
  const tasks = [
    call("c1", "TaskCreate", { subject: "Write it" }),
    result("c1", "Task #1 created successfully: Write it", { task: { id: "1", subject: "Write it" } }),
    call("c2", "TaskCreate", { subject: "Test it" }),
    result("c2", "Task #2 created successfully: Test it"),
    call("c3", "TaskCreate", { subject: "Drop it" }),
    result("c3", "Task #3 created successfully: Drop it"),
    call("u1", "TaskUpdate", { taskId: "1", status: "completed" }),
    call("u2", "TaskUpdate", { taskId: "3", status: "deleted" }),
  ];
  const exit = call("e", "ExitPlanMode", { plan: "# Plan\n\n- [x] Read the code\n* [ ] Change it\n- not a box\n" });
  const spec: Array<{ text: string; done: boolean }> = [{ text: "T1 (AC-1): do it", done: false }];

  it("takes TodoWrite first, with completed as done", () => {
    const s = buildAgentPaneSnapshot([...tasks, exit, todo], { sessionId: "x", fallbackPlan: spec });
    expect(s.planSource).toBe("todo");
    expect(s.plan).toEqual([{ text: "T1", done: true }, { text: "T2", done: false }]);
  });

  it("then folds the Task tools: updates set status, a deleted task leaves, ids come from the result", () => {
    const s = buildAgentPaneSnapshot([...tasks, exit], { sessionId: "x", fallbackPlan: spec });
    expect(s.planSource).toBe("task");
    expect(s.plan).toEqual([{ text: "Write it", done: true }, { text: "Test it", done: false }]);
  });

  it("then the checkboxes of an ExitPlanMode plan", () => {
    const s = buildAgentPaneSnapshot([exit], { sessionId: "x", fallbackPlan: spec });
    expect(s.planSource).toBe("exit-plan");
    expect(s.plan).toEqual([{ text: "Read the code", done: true }, { text: "Change it", done: false }]);
  });

  it("skips an ExitPlanMode plan with no checkboxes, then takes the spec's plan", () => {
    const bare = call("e2", "ExitPlanMode", { plan: "Just do it." });
    const s = buildAgentPaneSnapshot([bare], { sessionId: "x", fallbackPlan: spec });
    expect(s.planSource).toBe("spec");
    expect(s.plan).toEqual(spec);
  });

  it("hides the plan when nothing has one", () => {
    const s = buildAgentPaneSnapshot([prompt("hi")], { sessionId: "x" });
    expect(s.plan).toBeUndefined();
    expect(s.planSource).toBeUndefined();
  });

  it("keeps the plan tools out of the tool list", () => {
    const s = buildAgentPaneSnapshot([prompt("go"), todo, result("a"), call("r", "Read", { file_path: "/x" })], { sessionId: "x" });
    expect(s.turn!.tools!.map((t) => t.id)).toEqual(["r"]);
  });

  it("parses checkboxes in either bullet", () => {
    expect(parseCheckboxes("- [ ] a\n  * [X] b\nno")).toEqual([{ text: "a", done: false }, { text: "b", done: true }]);
    expect(parseCheckboxes("nothing")).toBeUndefined();
  });
});

describe("tokPerSecOf", () => {
  const response = (id: string, tokens: number, stamps: string[]): PaneEntry[] =>
    stamps.map((timestamp) => ({ timestamp, message: { id, role: "assistant", content: [], usage: { output_tokens: tokens } } }));
  const user = (timestamp: string): PaneEntry => ({ timestamp, message: { role: "user", content: "p" } });

  it("divides a response's tokens by the time from the entry before it to its last block", () => {
    const entries = [user("2026-10-09T10:00:00.000Z"), ...response("m1", 500, ["2026-10-09T10:00:00.500Z", "2026-10-09T10:00:01.000Z"])];
    expect(tokPerSecOf(entries)).toBe(500);
  });

  it("uses the latest response only", () => {
    const entries = [user("2026-10-09T10:00:00.000Z"), ...response("m1", 10, ["2026-10-09T10:00:10.000Z"]), user("2026-10-09T10:00:11.000Z"), ...response("m2", 300, ["2026-10-09T10:00:12.000Z"])];
    expect(tokPerSecOf(entries)).toBe(300);
  });

  it("says nothing without usage, a stamp before the response, or a positive interval", () => {
    expect(tokPerSecOf([])).toBeUndefined();
    expect(tokPerSecOf(response("m1", 5, ["2026-10-09T10:00:00Z"]))).toBeUndefined();
    expect(tokPerSecOf([user("2026-10-09T10:00:00Z"), ...response("m1", 5, ["2026-10-09T10:00:00Z"])])).toBeUndefined();
    expect(tokPerSecOf([user("2026-10-09T10:00:00Z"), { timestamp: "2026-10-09T10:00:01Z", message: { id: "m", role: "assistant" } }])).toBeUndefined();
  });
});

describe("diffSnapshots", () => {
  const base = buildAgentPaneSnapshot(refactor.slice(0, 20), { sessionId: "s" });
  const more = buildAgentPaneSnapshot(refactor, { sessionId: "s" });

  it("says nothing when nothing changed", () => {
    expect(diffSnapshots(more, more)).toBeUndefined();
  });

  it("sends a whole snapshot first, and when the turn changes", () => {
    expect(diffSnapshots(undefined, base)?.kind).toBe("snapshot");
    const other = buildAgentPaneSnapshot([prompt("another"), call("z", "Read", { file_path: "/z" })], { sessionId: "s" });
    expect(diffSnapshots(more, other)?.kind).toBe("snapshot");
  });

  it("sends a delta for the same turn: the tools that are new or changed, by id", () => {
    const d = diffSnapshots(base, more);
    expect(d?.kind).toBe("delta");
    if (d?.kind !== "delta") return;
    const known = new Map(base.turn!.tools!.map((t) => [t.id, t]));
    for (const t of d.delta.tools!) expect(JSON.stringify(known.get(t.id))).not.toBe(JSON.stringify(t));
    expect(d.delta.tools!.length).toBeGreaterThan(0);
    expect(d.delta.toolCount).toBe(14);
  });

  it("carries a tool that finished as a replacement of the running one", () => {
    const entries = [prompt("go"), call("t", "Bash", { command: "make" })];
    const running = buildAgentPaneSnapshot(entries, { sessionId: "s" });
    const done = buildAgentPaneSnapshot([...entries, result("t")], { sessionId: "s" });
    const d = diffSnapshots(running, done);
    expect(d).toMatchObject({ kind: "delta", delta: { tools: [{ id: "t", state: "done" }] } });
  });

  it("falls back to a snapshot when a field goes away", () => {
    expect(diffSnapshots(more, { ...more, plan: undefined, planSource: undefined, toolCount: 15 })?.kind).toBe("snapshot");
  });
});
