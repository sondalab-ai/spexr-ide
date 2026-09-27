import { describe, expect, it } from "vitest";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { OPENCODE_SESSION_WAIT_MS, watchOpencodeTask, type WallScanSource } from "./opencode-task-watcher.js";
import type { WatchEvent } from "./claude-task-watcher.js";

function tile(sessionId: string, projectPath: string, o: Partial<AgentTile>): AgentTile {
  return { sessionId, projectPath, harness: "opencode", state: "working", needsYou: false, needsYouCertain: false, ...o } as AgentTile;
}

function source() {
  let emit: (t: AgentTile[]) => void = () => {};
  let scans = 0;
  const s: WallScanSource = {
    onScanned: (l) => ((emit = l), () => (emit = () => {})),
    requestScan: () => void (scans += 1),
    knownSessionIds: () => new Set(["old"]),
    scanEntries: async () => [
      { message: { role: "user", content: "p" } },
      { message: { role: "assistant", content: [{ type: "text", text: "all set" }] } },
    ],
  };
  return { s, emit: (t: AgentTile[]) => emit(t), scans: () => scans };
}

describe("watchOpencodeTask", () => {
  it("adopts the first unknown session in its folder and reports its turn end", async () => {
    const src = source();
    let now = 0;
    const events: WatchEvent[] = [];
    watchOpencodeTask({ workspace: "/repo" }, src.s, { now: () => now, every: () => () => {} }, (e) => events.push(e));
    src.emit([tile("old", "/repo", {}), tile("other", "/elsewhere", {}), tile("new", "/repo/", {})]);
    expect(events).toEqual([{ type: "session-found", sessionId: "new" }]);
    src.emit([tile("new", "/repo", { state: "idle", needsYou: true })]);
    await new Promise((r) => setTimeout(r, 0));
    expect(events.at(-1)).toEqual({ type: "turn-ended", reply: "all set" });
  });

  it("delivers nothing after stop(), even for a turn-end scan already in flight", async () => {
    let emit: (t: AgentTile[]) => void = () => {};
    let resolveEntries: (entries: unknown[]) => void = () => {};
    const s: WallScanSource = {
      onScanned: (l) => ((emit = l), () => (emit = () => {})),
      requestScan: () => {},
      knownSessionIds: () => new Set(["old"]),
      scanEntries: async () => new Promise((resolve) => (resolveEntries = resolve)),
    };
    const now = 0;
    const events: WatchEvent[] = [];
    const watch = watchOpencodeTask({ workspace: "/repo" }, s, { now: () => now, every: () => () => {} }, (e) =>
      events.push(e),
    );
    emit([tile("new", "/repo", {})]);
    expect(events).toEqual([{ type: "session-found", sessionId: "new" }]);
    emit([tile("new", "/repo", { state: "idle", needsYou: true })]);
    watch.stop();
    resolveEntries([
      { message: { role: "user", content: "p" } },
      { message: { role: "assistant", content: [{ type: "text", text: "too late" }] } },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual([{ type: "session-found", sessionId: "new" }]);
  });

  it("asks for scans on its own clock and gives up after the wait", () => {
    const src = source();
    let now = 0;
    let tick: () => void = () => {};
    const events: WatchEvent[] = [];
    watchOpencodeTask(
      { workspace: "/repo" },
      src.s,
      { now: () => now, every: (fn) => ((tick = () => void fn()), () => (tick = () => {})) },
      (e) => events.push(e),
    );
    tick();
    expect(src.scans()).toBe(1);
    now = OPENCODE_SESSION_WAIT_MS + 1;
    src.emit([]);
    expect(events).toEqual([{ type: "session-missing" }]);
  });

  it("after a paste, counts the next turn end only once the scan shows a newer prompt (re-arm, R1)", async () => {
    const src = source();
    const events: WatchEvent[] = [];
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const turnEnds = () => events.filter((e) => e.type === "turn-ended").length;
    const watch = watchOpencodeTask({ workspace: "/repo" }, src.s, { now: () => 0, every: () => () => {} }, (e) =>
      events.push(e),
    );
    src.emit([tile("new", "/repo", { state: "idle", needsYou: true, turnCount: 1 })]);
    await flush();
    expect(turnEnds()).toBe(1);
    watch.arm();
    src.emit([tile("new", "/repo", { state: "idle", needsYou: true, turnCount: 1 })]); // the old reply, still on screen
    await flush();
    expect(turnEnds()).toBe(1);
    src.emit([tile("new", "/repo", { state: "idle", needsYou: true, turnCount: 2 })]); // answered between two scans
    await flush();
    expect(turnEnds()).toBe(2);
    src.emit([tile("new", "/repo", { state: "idle", needsYou: true, turnCount: 2 })]);
    await flush();
    expect(turnEnds()).toBe(2);
  });
});
