import { describe, expect, it, vi, beforeEach } from "vitest";
import { writeSync } from "node:fs";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { createOpencodeHarness, opencodeHarness, opencodeMessageToEntry, opencodeExportToEntries } from "./opencode-harness.js";
import { STALE_MS } from "../session-timing.js";

const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;

/**
 * Route the mocked `spawn` by argv, writing `{ stdout }` to the real stdout fd
 * (runOpencode redirects it to a temp file because Bun truncates pipes) and
 * emitting `close`, or emitting `error`. The fd write happens before `close`
 * so the production `readFileSync` sees the payload.
 */
function mockCli(handler: (args: string[]) => { stdout?: string; err?: Error }): void {
  spawnMock.mockImplementation((...all: unknown[]) => {
    const args = (all.find((a) => Array.isArray(a)) ?? []) as string[];
    const opts = all.find((a) => !!a && typeof a === "object" && !Array.isArray(a)) as { stdio?: unknown[] } | undefined;
    const { stdout = "", err = null } = handler(args);
    const handlers: Record<string, (...a: unknown[]) => void> = {};
    const child = {
      once(event: string, cb: (...a: unknown[]) => void): unknown {
        handlers[event] = cb;
        return child;
      },
    };
    const fd = Array.isArray(opts?.stdio) ? (opts.stdio![1] as number) : undefined;
    setImmediate(() => {
      if (!err && typeof fd === "number") {
        try {
          writeSync(fd, stdout);
        } catch {
          /* fd already closed */
        }
      }
      if (err) handlers["error"]?.(err);
      else handlers["close"]?.(0);
    });
    return child;
  });
}

describe("opencodeHarness.isResumableId", () => {
  it("accepts opaque ses_ ids", () => {
    expect(opencodeHarness.isResumableId("ses_fefddda33fferVOQBC6QZrlycV")).toBe(true);
    expect(opencodeHarness.isResumableId("ses_abc123")).toBe(true);
  });

  it("rejects non-ses ids and shell metacharacters", () => {
    expect(opencodeHarness.isResumableId("")).toBe(false);
    expect(opencodeHarness.isResumableId("0f8f…cdef")).toBe(false);
    expect(opencodeHarness.isResumableId("ses_abc;rm -rf /")).toBe(false);
    expect(opencodeHarness.isResumableId("ses_abc$(x)")).toBe(false);
    expect(opencodeHarness.isResumableId("ses_abc def")).toBe(false);
  });
});

describe("opencodeHarness.buildResumeArgs", () => {
  it("resumes with --session <id>", () => {
    expect(opencodeHarness.buildResumeArgs("ses_abc", false)).toEqual(["--session", "ses_abc"]);
  });

  it("adds --fork (not Claude's --fork-session) when forking", () => {
    expect(opencodeHarness.buildResumeArgs("ses_abc", true)).toEqual(["--session", "ses_abc", "--fork"]);
  });
});

describe("opencodeMessageToEntry", () => {
  it("maps text parts to text blocks and tool parts to tool_use blocks", () => {
    const entry = opencodeMessageToEntry({
      info: { role: "assistant" },
      parts: [
        { type: "text", text: "On it." },
        { type: "tool", tool: "bash", state: { input: { command: "pnpm test" } } },
      ],
    });
    expect(entry).toEqual({
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "On it." },
          { type: "tool_use", name: "Bash", input: { command: "pnpm test" } },
        ],
      },
    });
  });

  it("maps opencode tool names/inputs to Claude shape (bash→Bash, filePath→file_path)", () => {
    const entry = opencodeMessageToEntry({
      info: { role: "assistant" },
      parts: [
        { type: "tool", tool: "bash", state: { input: { command: "pnpm test" } } },
        { type: "tool", tool: "read", state: { input: { filePath: "/x/auth.ts" } } },
      ],
    });
    expect(entry?.message.content).toEqual([
      { type: "tool_use", name: "Bash", input: { command: "pnpm test" } },
      { type: "tool_use", name: "Read", input: { file_path: "/x/auth.ts" } },
    ]);
  });

  it("drops messages with no usable parts and unknown roles", () => {
    expect(opencodeMessageToEntry({ info: { role: "assistant" }, parts: [{ type: "step-start" }] })).toBeUndefined();
    expect(opencodeMessageToEntry({ info: {}, parts: [{ type: "text", text: "x" }] })).toBeUndefined();
  });
});

describe("opencode entry normalization feeds the shared consumers", () => {
  const entries = opencodeExportToEntries([
    { info: { role: "user" }, parts: [{ type: "text", text: "fix the auth bug" }] },
    {
      info: { role: "assistant" },
      parts: [
        { type: "text", text: "On it." },
        { type: "tool", tool: "bash", state: { input: { command: "pnpm test" } } },
      ],
    },
  ]);

  it("distillAction / recentActions recognize the normalized tool_use blocks", async () => {
    const { distillAction, recentActions } = await import("../../node/darkfactory/action-distiller.js");
    expect(distillAction(entries as never)).toEqual({ line: "Running: pnpm test", tool: "Bash", target: "pnpm test" });
    expect(recentActions(entries as never, 4)).toEqual(["Bash pnpm test"]);
  });

  it("buildFollowEvents splits prompt, reply, and tool call into typed events", async () => {
    const { buildFollowEvents } = await import("../../node/darkfactory/turns.js");
    expect(buildFollowEvents(entries as never, 10)).toEqual([
      { kind: "prompt", text: "fix the auth bug" },
      { kind: "assistant", text: "On it." },
      { kind: "tool", text: "pnpm test" },
    ]);
  });
});

describe("opencodeHarness.parseTranscript (via export fixture)", () => {
  const ref = {
    sessionId: "ses_fixture",
    projectPath: "/tmp/proj",
    mtimeMs: 1786987872778,
    loadEntries: async () =>
      opencodeExportToEntries([
        { info: { role: "user" }, parts: [{ type: "text", text: "fix the auth bug" }] },
        {
          info: { role: "assistant" },
          parts: [
            { type: "tool", tool: "bash", state: { input: { command: "pnpm test" } } },
            { type: "text", text: "done" },
          ],
        },
      ]),
  };

  it("extracts goal, turns, lastTool, cwd, interactive", async () => {
    const p = await opencodeHarness.parseTranscript(ref);
    expect(p).toEqual({
      cwd: "/tmp/proj",
      userTurns: 1,
      goal: "fix the auth bug",
      lastPrompt: "fix the auth bug",
      lastTool: "Bash",
      interactive: true,
    });
  });

  it("returns empty fields for an export with no messages", async () => {
    const empty = { ...ref, loadEntries: async () => [] };
    const p = await opencodeHarness.parseTranscript(empty);
    expect(p).toEqual({ cwd: "/tmp/proj", userTurns: 0, goal: "", lastPrompt: "", interactive: true });
  });
});

describe("opencode tool_result failure signal", () => {
  it("emits is_error for a failed tool so lastActionFailed sees it", async () => {
    const { lastActionFailed } = await import("../../node/darkfactory/action-distiller.js");
    const entries = opencodeExportToEntries([
      { info: { role: "assistant" }, parts: [{ type: "tool", tool: "bash", state: { input: { command: "x" }, status: "error" } }] },
    ]);
    expect(lastActionFailed(entries as never)).toBe(true);
  });

  it("a completed tool is not a failure", async () => {
    const { lastActionFailed } = await import("../../node/darkfactory/action-distiller.js");
    const entries = opencodeExportToEntries([
      { info: { role: "assistant" }, parts: [{ type: "tool", tool: "bash", state: { input: { command: "x" }, status: "completed" } }] },
    ]);
    expect(lastActionFailed(entries as never)).toBe(false);
  });

  it("the last tool's outcome wins (completed after an earlier error → not failed)", async () => {
    const { lastActionFailed } = await import("../../node/darkfactory/action-distiller.js");
    const entries = opencodeExportToEntries([
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool", tool: "bash", state: { input: { command: "boom" }, status: "error" } },
          { type: "tool", tool: "bash", state: { input: { command: "ok" }, status: "completed" } },
        ],
      },
    ]);
    expect(lastActionFailed(entries as never)).toBe(false);
  });
});

describe("opencodeHarness.listSessions (mocked opencode db)", () => {
  beforeEach(() => spawnMock.mockReset());

  const rows = [
    { id: "ses_a", directory: "/p/a", parent_id: null, title: "t", agent: "x", model: "m", time_created: 1, time_updated: 20 },
    { id: "ses_b", directory: "/p/b", parent_id: null, title: "u", agent: "x", model: "m", time_created: 2, time_updated: 10 },
  ];

  it("maps db rows to refs (sessionId, projectPath, mtimeMs) preserving order", async () => {
    mockCli(() => ({ stdout: JSON.stringify(rows) }));
    const refs = await opencodeHarness.listSessions();
    expect(refs.map((r) => [r.sessionId, r.projectPath, r.mtimeMs])).toEqual([
      ["ses_a", "/p/a", 20],
      ["ses_b", "/p/b", 10],
    ]);
  });

  it("memoizes loadEntries — one `opencode export` spawn per ref per scan", async () => {
    let exportCalls = 0;
    mockCli((args) => {
      if (args[0] === "db") return { stdout: JSON.stringify([rows[0]]) };
      exportCalls++;
      return { stdout: JSON.stringify({ messages: [{ info: { role: "user" }, parts: [{ type: "text", text: "hi" }] }] }) };
    });
    const [ref] = await opencodeHarness.listSessions();
    const first = await ref.loadEntries();
    const second = await ref.loadEntries();
    expect(exportCalls).toBe(1);
    expect(first).toBe(second); // same memoized result, not a re-read
  });

  it("resolves to [] when `opencode db` fails (enumeration unavailable)", async () => {
    mockCli(() => ({ err: new Error("command not found") }));
    expect(await opencodeHarness.listSessions()).toEqual([]);
  });

  it("resolves to [] on non-JSON stdout", async () => {
    mockCli(() => ({ stdout: "Exporting session: …not json" }));
    expect(await opencodeHarness.listSessions()).toEqual([]);
  });

  it("resolves to [] when the query yields a non-array", async () => {
    mockCli(() => ({ stdout: JSON.stringify({ error: "bad schema" }) }));
    expect(await opencodeHarness.listSessions()).toEqual([]);
  });
});

describe("opencode export cache (injected runner)", () => {
  /** Far past every `time_updated` below except where a test sets it near: all dormant. */
  const NOW = 1_000_000_000_000;
  type Row = { id: string; time_updated: number };
  const row = (id: string, time_updated: number) => ({
    id, directory: `/p/${id}`, parent_id: null, title: "t", agent: "x", model: "m", time_created: 1, time_updated,
  });

  /** A runner answering `db` with the current rows and counting `export` spawns per session. */
  function fakeRunner(initial: Row[]) {
    const state = { rows: initial, exports: [] as string[], failNext: false, dbCalls: 0 };
    const run = async (args: string[]): Promise<string> => {
      if (args[0] === "db") {
        state.dbCalls++;
        return JSON.stringify(state.rows.map((r) => row(r.id, r.time_updated)));
      }
      state.exports.push(args[1]!);
      if (state.failNext) {
        state.failNext = false;
        throw new Error("opencode export timed out");
      }
      return JSON.stringify({ messages: [{ info: { role: "user" }, parts: [{ type: "text", text: `hi ${args[1]}` }] }] });
    };
    return { state, run };
  }

  async function scan(harness: ReturnType<typeof createOpencodeHarness>) {
    const refs = await harness.listSessions();
    return Promise.all(refs.map((r) => r.loadEntries()));
  }

  it("exports an unchanged session once across scans", async () => {
    const { state, run } = fakeRunner([{ id: "ses_a", time_updated: 20 }]);
    const harness = createOpencodeHarness(run, () => NOW);
    const [first] = await scan(harness);
    const [second] = await scan(harness);
    expect(state.exports).toEqual(["ses_a"]);
    expect(second).toBe(first);
    expect(state.dbCalls).toBe(2);
  });

  it("re-exports a session whose last update moved", async () => {
    const { state, run } = fakeRunner([{ id: "ses_a", time_updated: 20 }]);
    const harness = createOpencodeHarness(run, () => NOW);
    await scan(harness);
    state.rows = [{ id: "ses_a", time_updated: 21 }];
    await scan(harness);
    await scan(harness);
    expect(state.exports).toEqual(["ses_a", "ses_a"]);
  });

  it("forgets a session that is no longer listed", async () => {
    const { state, run } = fakeRunner([{ id: "ses_a", time_updated: 20 }, { id: "ses_b", time_updated: 10 }]);
    const harness = createOpencodeHarness(run, () => NOW);
    await scan(harness);
    state.rows = [{ id: "ses_b", time_updated: 10 }];
    await scan(harness);
    state.rows = [{ id: "ses_a", time_updated: 20 }, { id: "ses_b", time_updated: 10 }];
    await scan(harness);
    expect(state.exports.sort()).toEqual(["ses_a", "ses_a", "ses_b"]);
  });

  it("retries a failed export on the next scan instead of keeping it empty", async () => {
    const { state, run } = fakeRunner([{ id: "ses_a", time_updated: 20 }]);
    const harness = createOpencodeHarness(run, () => NOW);
    state.failNext = true;
    const [failed] = await scan(harness);
    expect(failed).toEqual([]);
    const [retried] = await scan(harness);
    expect(retried).toHaveLength(1);
    await scan(harness);
    expect(state.exports).toEqual(["ses_a", "ses_a"]);
  });

  it("keeps at most 100 sessions, dropping the least recently read", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ id: `ses_${i}`, time_updated: 1 }));
    const { state, run } = fakeRunner(rows);
    const harness = createOpencodeHarness(run, () => NOW);
    await scan(harness);
    expect(state.exports).toHaveLength(101);
    const refs = await harness.listSessions();
    await refs.find((r) => r.sessionId === "ses_100")!.loadEntries();
    await refs.find((r) => r.sessionId === "ses_0")!.loadEntries();
    expect(state.exports.slice(101)).toEqual(["ses_0"]);
  });

  it("re-exports a session updated within the live window on every scan", async () => {
    const { state, run } = fakeRunner([{ id: "ses_a", time_updated: NOW - STALE_MS }]);
    const harness = createOpencodeHarness(run, () => NOW);
    await scan(harness);
    await scan(harness);
    await scan(harness);
    expect(state.exports).toEqual(["ses_a", "ses_a", "ses_a"]);
  });

  it("starts caching a session once it has been quiet past the live window", async () => {
    let now = NOW;
    const { state, run } = fakeRunner([{ id: "ses_a", time_updated: NOW }]);
    const harness = createOpencodeHarness(run, () => now);
    await scan(harness);
    await scan(harness);
    now = NOW + STALE_MS + 1;
    await scan(harness);
    await scan(harness);
    await scan(harness);
    expect(state.exports).toEqual(["ses_a", "ses_a", "ses_a"]);
  });
});
