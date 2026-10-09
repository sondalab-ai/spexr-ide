import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AgentPaneBackendService, encodeProjectDir } from "./agent-pane-service.js";
import type { AgentPaneClient, AgentPaneDelta, AgentPaneSnapshot } from "../../common/agent-pane-protocol.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "spexr-agentpane-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
interface Setup {
  ws: string;
  config: string;
  projects: string;
  names: string;
  now: { t: number };
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
  const client: AgentPaneClient = {
    onSnapshot: (s) => events.push(["snapshot", s]),
    onDelta: (d) => events.push(["delta", d]),
    onSessionAdopted: (a, b) => events.push(["adopted", a, b]),
  };
  const svc = new AgentPaneBackendService({
    configDirs: () => [config],
    now: () => now.t,
    watch: () => undefined,
    liveDirs: async () => new Set([ws]),
    namesPath: names,
    specPlan: async () => undefined,
  });
  svc.setClient(client);
  return { ws, config, projects, names, now, events, svc };
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
    write(s.projects, "A", head("A") + promptLine("A", s.ws, 1, "make it so") + useLine("A", s.ws, 2, "t1", "pnpm test"), 1_800_000_000);
    const snap = await s.svc.follow({ sessionId: "A", workspacePath: s.ws });
    expect(snap?.turn?.prompt).toBe("make it so");
    expect(snap?.turn?.tools?.map((t) => [t.target, t.state])).toEqual([["pnpm test", "run"]]);
    expect(snap?.toolCount).toBe(1);
    expect(snap?.state).toBe("working");
    expect(snap?.title).toBe("make it so");
    expect(s.events.map((e) => e[0])).toEqual(["snapshot"]);
    await s.svc.stop();
  });

  it("names the pane with the name the user gave the session", async () => {
    writeFileSync(s.names, JSON.stringify({ A: "Refactor the audit" }));
    write(s.projects, "A", head("A") + promptLine("A", s.ws, 1, "make it so"), 1_800_000_000);
    expect((await s.svc.follow({ sessionId: "A", workspacePath: s.ws }))?.title).toBe("Refactor the audit");
    await s.svc.stop();
  });

  it("pushes a delta for what the transcript gained", async () => {
    const path = write(s.projects, "A", head("A") + promptLine("A", s.ws, 1, "go") + useLine("A", s.ws, 2, "t1", "make"), 1_800_000_000);
    await s.svc.follow({ sessionId: "A", workspacePath: s.ws });
    appendFileSync(path, resultLine("A", s.ws, 4, "t1") + useLine("A", s.ws, 5, "t2", "make test"));
    await s.svc.refresh();
    const last = s.events[s.events.length - 1]!;
    expect(last[0]).toBe("delta");
    const delta = last[1] as AgentPaneDelta;
    expect(delta.tools?.map((t) => [t.id, t.state])).toEqual([["t1", "done"], ["t2", "run"]]);
    expect(delta.toolCount).toBe(2);
    await s.svc.stop();
  });

  it("waits for a transcript that does not exist yet, and pushes its snapshot once it does", async () => {
    expect(await s.svc.follow({ sessionId: "A", workspacePath: s.ws })).toBeUndefined();
    expect(s.events).toEqual([]);
    write(s.projects, "A", head("A") + promptLine("A", s.ws, 1, "late"), 1_800_000_000);
    await s.svc.refresh();
    expect(s.events[0]![0]).toBe("snapshot");
    expect((s.events[0]![1] as AgentPaneSnapshot).turn?.prompt).toBe("late");
    await s.svc.stop();
  });

  it("adopts the transcript a /clear started, and says so", async () => {
    write(s.projects, "A", head("A") + promptLine("A", s.ws, 1, "first") + useLine("A", s.ws, 2, "t1", "make"), 1_800_000_000);
    await s.svc.follow({ sessionId: "A", workspacePath: s.ws });
    s.events.length = 0;
    write(s.projects, "B", head("B") + promptLine("B", s.ws, 100, "after the clear"), 1_800_000_100);
    s.now.t += 5000; // past the successor check the follow's first read made
    await s.svc.refresh();
    expect(s.events.map((e) => e[0])).toEqual(["adopted", "snapshot"]);
    expect(s.events[0]).toEqual(["adopted", "A", "B"]);
    expect((s.events[1]![1] as AgentPaneSnapshot).sessionId).toBe("B");
    expect((s.events[1]![1] as AgentPaneSnapshot).turn?.prompt).toBe("after the clear");
    await s.svc.stop();
  });

  it("adopts the copy a /resume wrote, which carries the conversation and more", async () => {
    const a = head("A") + promptLine("A", s.ws, 1, "first") + useLine("A", s.ws, 2, "t1", "make") + resultLine("A", s.ws, 3, "t1");
    write(s.projects, "A", a, 1_800_000_000);
    await s.svc.follow({ sessionId: "A", workspacePath: s.ws });
    s.events.length = 0;
    // The copy repeats A's lines (uuids included) and goes on.
    write(s.projects, "R", head("R") + a + promptLine("R", s.ws, 50, "resumed prompt"), 1_800_000_050);
    s.now.t += 5000;
    await s.svc.refresh();
    expect(s.events[0]).toEqual(["adopted", "A", "R"]);
    await s.svc.stop();
  });

  it("stays on its session when nothing newer was written", async () => {
    write(s.projects, "A", head("A") + promptLine("A", s.ws, 1, "first"), 1_800_000_100);
    write(s.projects, "OLD", head("OLD") + promptLine("OLD", s.ws, 0, "older"), 1_800_000_000);
    await s.svc.follow({ sessionId: "A", workspacePath: s.ws });
    s.events.length = 0;
    await s.svc.refresh();
    expect(s.events).toEqual([]);
    await s.svc.stop();
  });

  it("checks for a successor at most every few seconds", async () => {
    write(s.projects, "A", head("A") + promptLine("A", s.ws, 1, "first"), 1_800_000_000);
    await s.svc.follow({ sessionId: "A", workspacePath: s.ws });
    s.events.length = 0;
    write(s.projects, "B", head("B") + promptLine("B", s.ws, 100, "next"), 1_800_000_100);
    await s.svc.refresh();
    expect(s.events).toEqual([]);
    s.now.t += 5000;
    await s.svc.refresh();
    expect(s.events[0]).toEqual(["adopted", "A", "B"]);
    await s.svc.stop();
  });

  it("stops: nothing is pushed afterwards", async () => {
    const path = write(s.projects, "A", head("A") + promptLine("A", s.ws, 1, "first"), 1_800_000_000);
    await s.svc.follow({ sessionId: "A", workspacePath: s.ws });
    await s.svc.stop();
    s.events.length = 0;
    appendFileSync(path, useLine("A", s.ws, 2, "t1", "make"));
    await s.svc.refresh();
    expect(s.events).toEqual([]);
  });
});
