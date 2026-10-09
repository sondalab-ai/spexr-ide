import { describe, expect, it } from "vitest";
import { AGENT_PANE_MIGRATION_KEY, takeAgentPaneReveal } from "./agent-pane-migration.js";

const memory = (): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("takeAgentPaneReveal", () => {
  it("is true once, then never, and records it", () => {
    const store = memory();
    expect(takeAgentPaneReveal(store)).toBe(true);
    expect(store.data.get(AGENT_PANE_MIGRATION_KEY)).toBe("1");
    expect(takeAgentPaneReveal(store)).toBe(false);
    expect(takeAgentPaneReveal(store)).toBe(false);
  });

  it("is false for a store that throws, or one that does not keep what it is given", () => {
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => undefined };
    expect(takeAgentPaneReveal(throwing)).toBe(false);
    const forgetful = { getItem: () => null, setItem: () => undefined };
    expect(takeAgentPaneReveal(forgetful)).toBe(false);
  });
});
