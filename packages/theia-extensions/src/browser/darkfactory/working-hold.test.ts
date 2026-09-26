import { describe, expect, it } from "vitest";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { WORKING_HOLD_MS, WorkingHold } from "./working-hold.js";

const tile = (sessionId: string, over: Partial<AgentTile> = {}): AgentTile =>
  ({ sessionId, state: "working", needsYou: false, needsYouCertain: false, lastFailed: false, ...over }) as AgentTile;
const waiting = (id: string): AgentTile => tile(id, { state: "idle", needsYou: true });

describe("WorkingHold", () => {
  it("keeps a card working for a moment after its work stops", () => {
    const hold = new WorkingHold();
    hold.apply([tile("a")], 0);
    const { tiles, nextExpiry } = hold.apply([waiting("a")], 1_000);
    expect(tiles[0]).toMatchObject({ state: "working", needsYou: false });
    expect(nextExpiry).toBe(WORKING_HOLD_MS);
  });

  it("lets the card go once the hold has passed", () => {
    const hold = new WorkingHold();
    hold.apply([tile("a")], 0);
    const { tiles, nextExpiry } = hold.apply([waiting("a")], WORKING_HOLD_MS);
    expect(tiles[0]).toMatchObject({ state: "idle", needsYou: true });
    expect(nextExpiry).toBeUndefined();
  });

  it("measures the hold from the last scan that saw it working", () => {
    const hold = new WorkingHold();
    hold.apply([tile("a")], 0);
    hold.apply([tile("a")], 3_000);
    expect(hold.apply([waiting("a")], WORKING_HOLD_MS + 1_000).tiles[0]!.state).toBe("working");
  });

  it("shows a blocking prompt at once", () => {
    const hold = new WorkingHold();
    hold.apply([tile("a")], 0);
    const blocked = tile("a", { state: "idle", needsYou: true, needsYouCertain: true });
    expect(hold.apply([blocked], 500).tiles[0]).toBe(blocked);
  });

  it("shows a failure at once", () => {
    const hold = new WorkingHold();
    hold.apply([tile("a")], 0);
    const failed = tile("a", { state: "idle", lastFailed: true });
    expect(hold.apply([failed], 500).tiles[0]).toBe(failed);
  });

  it("never holds a card it has not seen working", () => {
    const hold = new WorkingHold();
    const idle = waiting("a");
    expect(hold.apply([idle], 0).tiles[0]).toBe(idle);
  });

  it("forgets sessions that leave the wall", () => {
    const hold = new WorkingHold();
    hold.apply([tile("a")], 0);
    hold.apply([], 100);
    expect(hold.apply([waiting("a")], 200).tiles[0]!.state).toBe("idle");
  });
});
