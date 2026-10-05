import { describe, expect, it } from "vitest";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { WORKING_HOLD_MS } from "../darkfactory/working-hold.js";
import { AgentsCount } from "./agents-count.js";

const tile = (sessionId: string, over: Partial<AgentTile> = {}): AgentTile =>
  ({ sessionId, state: "working", needsYou: false, needsYouCertain: false, lastFailed: false, ...over }) as AgentTile;
const idle = (sessionId: string, over: Partial<AgentTile> = {}): AgentTile => tile(sessionId, { state: "idle", ...over });

describe("AgentsCount", () => {
  it("counts the working sessions a push brings", () => {
    expect(new AgentsCount().push([tile("a"), idle("b"), tile("c")], 0)).toEqual({ count: 2 });
  });

  it("runs one read at a time, and frees the slot when the read ends, failed or not", () => {
    const agents = new AgentsCount();
    const first = agents.startRead();
    expect(first).toBeDefined();
    expect(agents.startRead()).toBeUndefined();
    expect(agents.finishRead(first!, undefined, 0)).toBeUndefined();
    const second = agents.startRead();
    expect(second).toBeDefined();
    expect(agents.finishRead(second!, [tile("a")], 0)).toEqual({ count: 1 });
  });

  it("drops a read that a push overtook: the older snapshot never overwrites the pushed count", () => {
    const agents = new AgentsCount();
    const token = agents.startRead()!;
    expect(agents.push([tile("a"), tile("b")], 0)).toEqual({ count: 2 });
    expect(agents.finishRead(token, [], 10)).toBeUndefined();
    // The slot is free again, and the next read counts.
    const next = agents.startRead()!;
    expect(agents.finishRead(next, [tile("a")], 20)?.count).toBe(1);
  });

  it("drops an out-of-order read even when it lands after a later read was taken", () => {
    const agents = new AgentsCount();
    const stale = agents.startRead()!;
    agents.push([tile("a")], 0);
    expect(agents.finishRead(stale, [tile("a"), tile("b"), tile("c")], 5)).toBeUndefined();
    expect(agents.expire(6).count).toBe(1);
  });

  it("holds a session that just stopped working, as the wall does, and lets it go when the hold runs out", () => {
    const agents = new AgentsCount();
    agents.push([tile("a")], 0);
    const held = agents.push([idle("a")], 1_000);
    expect(held).toEqual({ count: 1, nextExpiry: WORKING_HOLD_MS });
    expect(agents.expire(WORKING_HOLD_MS)).toEqual({ count: 0 });
  });

  it("drops the hold at once for a session that failed or waits on a prompt", () => {
    const agents = new AgentsCount();
    agents.push([tile("a"), tile("b")], 0);
    expect(agents.push([idle("a", { lastFailed: true }), idle("b", { needsYou: true, needsYouCertain: true })], 500)).toEqual({ count: 0 });
  });

  it("holds across a read as across a push: a read is fed through the same hold", () => {
    const agents = new AgentsCount();
    agents.push([tile("a")], 0);
    const token = agents.startRead()!;
    expect(agents.finishRead(token, [idle("a")], 1_000)).toEqual({ count: 1, nextExpiry: WORKING_HOLD_MS });
  });
});
