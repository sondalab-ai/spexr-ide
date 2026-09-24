import { describe, expect, it } from "vitest";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { PINS_KEY, readPins, writePins, type StoredPin } from "./pinned-store.js";

const tile = (sessionId: string): AgentTile => ({ sessionId, projectPath: "/p" }) as AgentTile;

function storage(initial?: string) {
  const values: Record<string, string> = initial === undefined ? {} : { [PINS_KEY]: initial };
  return {
    values,
    getItem: (k: string) => values[k] ?? null,
    setItem: (k: string, v: string) => {
      values[k] = v;
    },
  };
}

describe("pinned store", () => {
  it("round-trips pins in order, with their terminals", () => {
    const s = storage();
    const pins: StoredPin[] = [
      { tile: tile("a"), terminal: { terminalId: 3, processId: 4242 } },
      { tile: tile("b") },
    ];
    writePins(s, pins);
    expect(readPins(s)).toEqual(pins);
  });

  it("is empty when nothing is stored or the value is unusable", () => {
    expect(readPins(storage())).toEqual([]);
    expect(readPins(storage("not json"))).toEqual([]);
    expect(readPins(storage('{"a":1}'))).toEqual([]);
  });

  it("drops entries without a session, and a terminal that is not a live id", () => {
    const raw = JSON.stringify([
      { tile: { projectPath: "/p" } },
      { tile: tile("ok"), terminal: { terminalId: -1, processId: 9 } },
      { tile: tile("half"), terminal: { terminalId: 2 } },
    ]);
    expect(readPins(storage(raw))).toEqual([{ tile: tile("ok") }, { tile: tile("half") }]);
  });

  it("survives storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPins(throwing)).toEqual([]);
    expect(() => writePins(throwing, [{ tile: tile("a") }])).not.toThrow();
  });
});
