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
});
