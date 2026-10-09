import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AgentPaneBackendService, encodeProjectDir } from "./agent-pane-service.js";
import type { AgentPaneClient, AgentPaneDelta, AgentPaneSnapshot } from "../../common/agent-pane-protocol.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "spexr-agentpane-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const IDS = {"A": "aaaaaaaa-0000-4000-8000-000000000001", "B": "bbbbbbbb-0000-4000-8000-000000000002", "R": "cccccccc-0000-4000-8000-000000000003", "OLD": "dddddddd-0000-4000-8000-000000000004"} as const;
let n = 0;
interface Setup {
  ws: string;
  config: string;
  projects: string;
  names: string;
  now: { t: number };
  watched: string[];
  closed: string[];
  live: { dirs: Set<string> };
  specReads: { n: number; plan: Array<{ text: string; done: boolean }> | undefined };
  events: Array<["snapshot", AgentPaneSnapshot] | ["delta", AgentPaneDelta] | ["adopted", string, string]>;
  svc: AgentPaneBackendService;
}

/** One workspace under its own account dir, a service with no watcher and no process table. */
function setup(): Setup {
  const base = join(root, `w${n++}`);
  const ws = join(base, "ws", "proj");
  const config = join(base, ".claude");
  const projects = join(config, "projects", encodeProjectDir(ws));
  mkdirSync(ws, { recursive: true });
  mkdirSync(projects, { recursive: true });
  const names = join(base, "names.json");
  const now = { t: 1_800_000_000_000 };
  const events: Setup["events"] = [];
  const watched: string[] = [];
  const closed: string[] = [];
  const live = { dirs: new Set([ws]) };
  const specReads = { n: 0, plan: undefined as Array<{ text: string; done: boolean }> | undefined };
  const client: AgentPaneClient = {
    onSnapshot: (s) => events.push(["snapshot", s]),
    onDelta: (d) => events.push(["delta", d]),
    onSessionAdopted: (a, b) => events.push(["adopted", a, b]),
  };
  const svc = new AgentPaneBackendService({
    configDirs: () => [config],
    now: () => now.t,
    watch: (path) => {
      watched.push(path);
      return { close: () => closed.push(path) };
    },
    liveDirs: async () => live.dirs,
    namesPath: names,
    specPlan: async () => {
      specReads.n++;
      return specReads.plan;
    },
  });
  svc.setClient(client);
  return { ws, config, projects, names, now, events, svc, watched, closed, live, specReads };
}

let seq = 0;
const stamp = (sec: number): string => new Date(Date.parse("2026-10-09T10:00:00Z") + sec * 1000).toISOString();
const line = (o: Record<string, unknown>): string => JSON.stringify(o) + "\n";
const env = (sessionId: string, cwd: string, sec: number): Record<string, unknown> => ({ uuid: `u-${sessionId}-${seq++}`, timestamp: stamp(sec), cwd, sessionId, entrypoint: "cli", userType: "external", isSidechain: false });
const head = (id: string): string => line({ type: "mode", mode: "normal", sessionId: id }) + line({ type: "permission-mode", permissionMode: "auto", sessionId: id });
const promptLine = (id: string, cwd: string, sec: number, text: string): string => line({ ...env(id, cwd, sec), type: "user", message: { role: "user", content: text } });
const useLine = (id: string, cwd: string, sec: number, toolId: string, command: string): string =>
  line({ ...env(id, cwd, sec), type: "assistant", message: { id: `m-${toolId}`, role: "assistant", model: "claude-opus-5-5", content: [{ type: "tool_use", id: toolId, name: "Bash", input: { command } }], usage: { output_tokens: 50 } } });
const resultLine = (id: string, cwd: string, sec: number, toolId: string): string =>
  line({ ...env(id, cwd, sec), type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: "ok" }] } });

/** Let the background tool count answer and take its delta, so a test starts from a settled pane. */
const settle = async (svc: AgentPaneBackendService): Promise<void> => {
  await new Promise((r) => setTimeout(r, 60));
  await svc.refresh();
};

const write = (dir: string, id: string, content: string, mtimeSec: number): string => {
  const path = join(dir, `${id}.jsonl`);
  writeFileSync(path, content);
  utimesSync(path, mtimeSec, mtimeSec);
  return path;
};

describe("AgentPaneBackendService", () => {
  let s: Setup;
  beforeEach(() => {
    s = setup();
  });

  it("finds the transcript by session id and returns the snapshot, pushing it too", async () => {
    write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "make it so") + useLine(IDS.A, s.ws, 2, "t1", "pnpm test"), 1_800_000_000);
    const snap = await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws });
    expect(snap?.turn?.prompt).toBe("make it so");
    expect(snap?.turn?.tools?.map((t) => [t.target, t.state])).toEqual([["pnpm test", "run"]]);
    expect(snap?.toolCount).toBe(1);
    expect(snap?.state).toBe("working");
    expect(snap?.title).toBe("make it so");
    expect(s.events.map((e) => e[0])).toEqual(["snapshot"]);
    await s.svc.stop();
  });

  it("names the pane with the name the user gave the session", async () => {
    writeFileSync(s.names, JSON.stringify({ [IDS.A]: "Refactor the audit" }));
    write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "make it so"), 1_800_000_000);
    expect((await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws }))?.title).toBe("Refactor the audit");
    await s.svc.stop();
  });

  it("pushes a delta for what the transcript gained", async () => {
    const path = write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "go") + useLine(IDS.A, s.ws, 2, "t1", "make"), 1_800_000_000);
    await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws });
    appendFileSync(path, resultLine(IDS.A, s.ws, 4, "t1") + useLine(IDS.A, s.ws, 5, "t2", "make test"));
    await s.svc.refresh();
    const last = s.events[s.events.length - 1]!;
    expect(last[0]).toBe("delta");
    const delta = last[1] as AgentPaneDelta;
    expect(delta.tools?.map((t) => [t.id, t.state])).toEqual([["t1", "done"], ["t2", "run"]]);
    expect(delta.toolCount).toBe(2);
    await s.svc.stop();
  });

  it("waits for a transcript that does not exist yet, and pushes its snapshot once it does", async () => {
    expect(await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws })).toBeUndefined();
    expect(s.events).toEqual([]);
    write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "late"), 1_800_000_000);
    await s.svc.refresh();
    expect(s.events[0]![0]).toBe("snapshot");
    expect((s.events[0]![1] as AgentPaneSnapshot).turn?.prompt).toBe("late");
    await s.svc.stop();
  });

  it("adopts the transcript a /clear started, and says so", async () => {
    write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "first") + useLine(IDS.A, s.ws, 2, "t1", "make"), 1_800_000_000);
    await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws });
    await settle(s.svc);
    s.events.length = 0;
    write(s.projects, IDS.B, head(IDS.B) + promptLine(IDS.B, s.ws, 100, "after the clear"), 1_800_000_100);
    s.now.t += 5000; // past the successor check the follow's first read made
    await s.svc.refresh();
    expect(s.events.map((e) => e[0])).toEqual(["adopted", "snapshot"]);
    expect(s.events[0]).toEqual(["adopted", IDS.A, IDS.B]);
    expect((s.events[1]![1] as AgentPaneSnapshot).sessionId).toBe(IDS.B);
    expect((s.events[1]![1] as AgentPaneSnapshot).turn?.prompt).toBe("after the clear");
    await s.svc.stop();
  });

  it("adopts the copy a /resume wrote, which carries the conversation and more", async () => {
    const a = head(IDS.A) + promptLine(IDS.A, s.ws, 1, "first") + useLine(IDS.A, s.ws, 2, "t1", "make") + resultLine(IDS.A, s.ws, 3, "t1");
    write(s.projects, IDS.A, a, 1_800_000_000);
    await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws });
    await settle(s.svc);
    s.events.length = 0;
    // The copy repeats A's lines (uuids included) and goes on.
    write(s.projects, IDS.R, head(IDS.R) + a + promptLine(IDS.R, s.ws, 50, "resumed prompt"), 1_800_000_050);
    s.now.t += 5000;
    await s.svc.refresh();
    expect(s.events[0]).toEqual(["adopted", IDS.A, IDS.R]);
    await s.svc.stop();
  });

  it("stays on its session when nothing newer was written", async () => {
    write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "first"), 1_800_000_100);
    write(s.projects, IDS.OLD, head(IDS.OLD) + promptLine(IDS.OLD, s.ws, 0, "older"), 1_800_000_000);
    await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws });
    await settle(s.svc);
    s.events.length = 0;
    await s.svc.refresh();
    expect(s.events).toEqual([]);
    await s.svc.stop();
  });

  it("checks for a successor at most every few seconds", async () => {
    write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "first"), 1_800_000_000);
    await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws });
    await settle(s.svc);
    s.events.length = 0;
    write(s.projects, IDS.B, head(IDS.B) + promptLine(IDS.B, s.ws, 100, "next"), 1_800_000_100);
    await s.svc.refresh();
    expect(s.events).toEqual([]);
    s.now.t += 5000;
    await s.svc.refresh();
    expect(s.events[0]).toEqual(["adopted", IDS.A, IDS.B]);
    await s.svc.stop();
  });

  it("stops: nothing is pushed afterwards", async () => {
    const path = write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "first"), 1_800_000_000);
    await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws });
    await s.svc.stop();
    await settle(s.svc);
    s.events.length = 0;
    appendFileSync(path, useLine(IDS.A, s.ws, 2, "t1", "make"));
    await s.svc.refresh();
    expect(s.events).toEqual([]);
  });

  it("refuses a session id that is not a UUID, and a workspace path that is not absolute and normalised", async () => {
    await expect(s.svc.follow({ sessionId: "../../etc/passwd", workspacePath: s.ws })).rejects.toThrow();
    await expect(s.svc.follow({ sessionId: "A", workspacePath: s.ws })).rejects.toThrow();
    await expect(s.svc.follow({ sessionId: IDS.A, workspacePath: "relative/dir" })).rejects.toThrow();
    await expect(s.svc.follow({ sessionId: IDS.A, workspacePath: `${s.ws}/../other` })).rejects.toThrow();
    await expect(s.svc.follow({ sessionId: IDS.A, workspacePath: "" })).rejects.toThrow();
    expect(s.watched).toEqual([]);
  });

  it("accepts a trailing slash on the workspace path", async () => {
    write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "slash"), 1_800_000_000);
    expect((await s.svc.follow({ sessionId: IDS.A, workspacePath: `${s.ws}/` }))?.turn?.prompt).toBe("slash");
    await s.svc.stop();
  });

  it("arms the folder's watcher once while the transcript is missing, however long it waits", async () => {
    await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws });
    await s.svc.refresh();
    await s.svc.refresh();
    await s.svc.refresh();
    expect(s.watched.filter((p) => p === s.projects)).toHaveLength(1);
    await s.svc.stop();
    expect(s.closed).toContain(s.projects);
  });

  it("takes a second follow after a stop as a fresh one: watchers closed, nothing of the first kept", async () => {
    write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "first"), 1_800_000_000);
    write(s.projects, IDS.B, head(IDS.B) + promptLine(IDS.B, s.ws, 2, "second"), 1_800_000_000);
    expect((await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws }))?.turn?.prompt).toBe("first");
    await s.svc.stop();
    const opened = s.watched.length;
    expect(s.closed.length).toBe(opened);
    expect((await s.svc.follow({ sessionId: IDS.B, workspacePath: s.ws }))?.turn?.prompt).toBe("second");
    expect(s.watched.length).toBe(opened * 2);
    await s.svc.stop();
    expect(s.closed.length).toBe(s.watched.length);
  });

  it("does not list the folder again while nothing in it changed", async () => {
    const path = write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "first"), 1_800_000_000);
    await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws });
    // A later, quiet transcript older than ours is no successor, and nothing triggers another look.
    s.now.t += 10_000;
    write(s.projects, IDS.OLD, head(IDS.OLD) + promptLine(IDS.OLD, s.ws, 0, "older"), 1_700_000_000);
    appendFileSync(path, useLine(IDS.A, s.ws, 5, "t1", "make"));
    await s.svc.refresh();
    await settle(s.svc);
    s.events.length = 0;
    appendFileSync(path, resultLine(IDS.A, s.ws, 6, "t1"));
    s.now.t += 10_000;
    await s.svc.refresh();
    expect(s.events.map((e) => e[0])).toEqual(["delta"]);
    await s.svc.stop();
  });

  it("follows a stored id to its successor only while a Claude runs in the folder", async () => {
    write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "old session") , 1_800_000_000);
    s.live.dirs = new Set();
    await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws, fromStorage: true });
    await settle(s.svc);
    s.events.length = 0;
    write(s.projects, IDS.B, head(IDS.B) + promptLine(IDS.B, s.ws, 100, "unrelated later session"), 1_800_000_100);
    s.now.t += 10_000;
    await s.svc.refresh();
    expect(s.events.filter((e) => e[0] === "adopted")).toEqual([]);
    // A process now runs there: the same newer transcript is the successor.
    s.live.dirs = new Set([s.ws]);
    s.now.t += 10_000;
    await s.svc.refresh();
    expect(s.events.filter((e) => e[0] === "adopted")).toEqual([["adopted", IDS.A, IDS.B]]);
    await s.svc.stop();
  });

  it("reads the spec plan only when the transcript has none, and not again while the folder stands still", async () => {
    s.specReads.plan = [{ text: "T1 do it", done: false }];
    const path = write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "no plan here"), 1_800_000_000);
    const first = await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws });
    expect(first?.plan).toEqual([{ text: "T1 do it", done: false }]);
    expect(first?.planSource).toBe("spec");
    appendFileSync(path, useLine(IDS.A, s.ws, 2, "t1", "make"));
    await s.svc.refresh();
    expect(s.specReads.n).toBe(1);
    // A TodoWrite in the transcript makes the spec's plan unnecessary: it is not read at all.
    const todo = line({ ...env(IDS.A, s.ws, 3), type: "assistant", message: { id: "m-todo", role: "assistant", content: [{ type: "tool_use", id: "td", name: "TodoWrite", input: { todos: [{ content: "A", status: "completed" }] } }] } });
    appendFileSync(path, todo);
    s.now.t += 10_000;
    await s.svc.refresh();
    expect(s.specReads.n).toBe(1);
    await s.svc.stop();
  });

  it("sends the first snapshot without waiting for the exact tool count, then the count as a delta", async () => {
    write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "go") + useLine(IDS.A, s.ws, 2, "t1", "a") + useLine(IDS.A, s.ws, 3, "t2", "b"), 1_800_000_000);
    const first = await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws });
    expect(first?.toolCount).toBe(2); // the window's count, until the scan answers
    await new Promise((r) => setTimeout(r, 400));
    await s.svc.refresh();
    expect(s.events.length).toBeGreaterThanOrEqual(1);
    await s.svc.stop();
  });

  it("dispose releases the follow and the client", async () => {
    write(s.projects, IDS.A, head(IDS.A) + promptLine(IDS.A, s.ws, 1, "go"), 1_800_000_000);
    await s.svc.follow({ sessionId: IDS.A, workspacePath: s.ws });
    s.svc.dispose();
    await new Promise((r) => setTimeout(r, 10));
    expect(s.closed.length).toBe(s.watched.length);
    await settle(s.svc);
    s.events.length = 0;
    await s.svc.refresh();
    expect(s.events).toEqual([]);
  });
});
