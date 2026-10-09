import { describe, expect, it } from "vitest";
import { AgentPaneController, type PaneTerminal } from "./agent-pane-controller.js";
import type { AgentPaneBinding, AgentPaneService, AgentPaneSnapshot } from "../../common/agent-pane-protocol.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const ROOT = "file:///w/proj";

class FakeService implements AgentPaneService {
  follows: AgentPaneBinding[] = [];
  stops = 0;
  /** Settles a follow; set per test. */
  answer: (b: AgentPaneBinding) => Promise<AgentPaneSnapshot | undefined> = async (b) => ({ sessionId: b.sessionId });
  async follow(b: AgentPaneBinding): Promise<AgentPaneSnapshot | undefined> {
    this.follows.push(b);
    return this.answer(b);
  }
  async stop(): Promise<void> {
    this.stops++;
  }
}

class FakeTerminal implements PaneTerminal {
  root: string | undefined = ROOT;
  running: string | undefined;
  stored: string | undefined;
  /** Delays the stored-id read, to make binds overlap. */
  storedGate: Promise<void> = Promise.resolve();
  adoptions: Array<[string, string]> = [];
  agentRootUri(): string | undefined {
    return this.root;
  }
  currentSessionId(): string | undefined {
    return this.running;
  }
  async storedSessionId(): Promise<string | undefined> {
    const stored = this.stored;
    await this.storedGate;
    return stored;
  }
  adoptSessionId(root: string, id: string): void {
    this.adoptions.push([root, id]);
  }
}

function make(): { service: FakeService; terminal: FakeTerminal; c: AgentPaneController; changes: { n: number }; warnings: string[] } {
  const service = new FakeService();
  const terminal = new FakeTerminal();
  const changes = { n: 0 };
  const warnings: string[] = [];
  const c = new AgentPaneController(service, terminal, (uri) => uri.replace("file://", ""), () => void changes.n++, (m) => void warnings.push(m));
  return { service, terminal, c, changes, warnings };
}

describe("AgentPaneController.bind", () => {
  it("follows the running agent's session by its workspace path", async () => {
    const { service, terminal, c } = make();
    terminal.running = A;
    await c.bind();
    expect(service.follows).toEqual([{ sessionId: A, workspacePath: "/w/proj" }]);
    expect(c.followed).toBe(A);
    expect(c.snapshot).toEqual({ sessionId: A });
  });

  it("follows a stored id when nothing runs, and marks it as from storage", async () => {
    const { service, terminal, c } = make();
    terminal.stored = B;
    await c.bind();
    expect(service.follows).toEqual([{ sessionId: B, workspacePath: "/w/proj", fromStorage: true }]);
  });

  it("prefers the running id over the stored one, and does not mark it", async () => {
    const { service, terminal, c } = make();
    terminal.running = A;
    terminal.stored = B;
    await c.bind();
    expect(service.follows).toHaveLength(1);
    expect(service.follows[0]!.sessionId).toBe(A);
    expect(service.follows[0]!.fromStorage).toBeUndefined();
  });

  it("shows the empty state and stops the service when there is no root or no session", async () => {
    const { service, terminal, c } = make();
    terminal.running = A;
    await c.bind();
    terminal.running = undefined;
    terminal.stored = undefined;
    await c.bind();
    expect(c.followed).toBeUndefined();
    expect(c.snapshot).toBeUndefined();
    expect(service.stops).toBe(1);
    terminal.root = undefined;
    terminal.running = A;
    await c.bind();
    expect(c.followed).toBeUndefined();
  });

  it("does not follow the session it already follows", async () => {
    const { service, terminal, c } = make();
    terminal.running = A;
    await c.bind();
    await c.bind();
    expect(service.follows).toHaveLength(1);
  });

  it("ends on the latest of two overlapping binds: the earlier one, still waiting, drops its result", async () => {
    const { service, terminal, c } = make();
    let release!: () => void;
    terminal.stored = A;
    terminal.storedGate = new Promise<void>((r) => (release = r));
    const slow = c.bind(); // reads the stored id A, then waits for the gate
    terminal.running = B;
    const fast = c.bind(); // the agent launched meanwhile: B, no storage read needed
    await fast;
    release();
    await slow;
    expect(c.followed).toBe(B);
    expect(service.follows.map((f) => f.sessionId)).toEqual([B]);
    expect(c.snapshot?.sessionId).toBe(B);
  });

  it("drops the answer of a follow that a later bind overtook", async () => {
    const { service, terminal, c } = make();
    let late!: (s: AgentPaneSnapshot) => void;
    service.answer = (b) => (b.sessionId === A ? new Promise<AgentPaneSnapshot>((r) => (late = r)) : Promise.resolve({ sessionId: b.sessionId }));
    terminal.running = A;
    const first = c.bind();
    await Promise.resolve();
    terminal.running = B;
    await c.bind();
    late({ sessionId: A, title: "stale" });
    await first;
    expect(c.snapshot).toEqual({ sessionId: B });
  });

  it("forgets a follow that failed, so the next bind tries again", async () => {
    const { service, terminal, c, warnings } = make();
    terminal.running = A;
    let fail = true;
    service.answer = async (b) => {
      if (fail) throw new Error("backend down");
      return { sessionId: b.sessionId };
    };
    await c.bind();
    expect(c.followed).toBeUndefined();
    expect(warnings).toHaveLength(1);
    fail = false;
    await c.bind();
    expect(c.followed).toBe(A);
    expect(service.follows).toHaveLength(2);
    expect(c.snapshot).toEqual({ sessionId: A });
  });
});

describe("AgentPaneController, what is pushed", () => {
  it("applies a snapshot and the deltas that follow, and drops those of another session", async () => {
    const { terminal, c } = make();
    terminal.running = A;
    await c.bind();
    c.snapshotPushed({ sessionId: A, turn: { tools: [{ id: "a", state: "run" }] } });
    c.deltaPushed({ sessionId: A, tools: [{ id: "a", state: "done" }] });
    c.deltaPushed({ sessionId: B, tools: [{ id: "z", state: "run" }] });
    c.snapshotPushed({ sessionId: B, title: "other" });
    expect(c.snapshot).toEqual({ sessionId: A, turn: { tools: [{ id: "a", state: "done" }] } });
  });

  it("holds a delta that beats its snapshot, and applies it on the snapshot", async () => {
    const { service, terminal, c } = make();
    terminal.running = A;
    let answer!: (s: AgentPaneSnapshot) => void;
    service.answer = () => new Promise<AgentPaneSnapshot>((r) => (answer = r));
    const binding = c.bind();
    await Promise.resolve();
    c.deltaPushed({ sessionId: A, state: "idle", needsYou: true });
    expect(c.snapshot).toBeUndefined();
    answer({ sessionId: A, state: "working" });
    await binding;
    expect(c.snapshot).toEqual({ sessionId: A, state: "idle", needsYou: true });
  });

  it("takes a pushed snapshot over the answer to follow when it came first", async () => {
    const { service, terminal, c } = make();
    terminal.running = A;
    let answer!: (s: AgentPaneSnapshot) => void;
    service.answer = () => new Promise<AgentPaneSnapshot>((r) => (answer = r));
    const binding = c.bind();
    await Promise.resolve();
    c.snapshotPushed({ sessionId: A, title: "pushed" });
    answer({ sessionId: A, title: "older answer" });
    await binding;
    expect(c.snapshot?.title).toBe("pushed");
  });
});

describe("AgentPaneController.adopted", () => {
  it("follows the successor, folds the tool card again and remembers the session as the agent's", async () => {
    const { terminal, c } = make();
    terminal.running = A;
    await c.bind();
    c.snapshotPushed({ sessionId: A, title: "old" });
    c.toggleExpanded();
    expect(c.expanded).toBe(true);
    c.adopted(A, B);
    expect(c.followed).toBe(B);
    expect(c.snapshot).toBeUndefined();
    expect(c.expanded).toBe(false);
    expect(terminal.adoptions).toEqual([[ROOT, B]]);
    c.snapshotPushed({ sessionId: B, title: "new" });
    expect(c.snapshot?.title).toBe("new");
  });

  it("ignores an adoption of a session it does not follow", async () => {
    const { terminal, c } = make();
    terminal.running = A;
    await c.bind();
    c.adopted(B, "cccccccc-0000-4000-8000-000000000003");
    expect(c.followed).toBe(A);
    expect(terminal.adoptions).toEqual([]);
  });

  it("starts a rebind to another session folded", async () => {
    const { terminal, c } = make();
    terminal.running = A;
    await c.bind();
    c.toggleExpanded();
    terminal.running = B;
    await c.bind();
    expect(c.expanded).toBe(false);
  });
});
