import { describe, expect, it } from "vitest";
import { AGENT_PANE_MIGRATION_KEY, agentPaneStartup, takeAgentPaneReveal } from "./agent-pane-migration.js";

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

describe("agentPaneStartup", () => {
  it("opens the pane, in front, on a fresh layout, and consumes the migration", () => {
    const store = memory();
    expect(agentPaneStartup(true, store)).toEqual({ open: true });
    expect(store.data.get(AGENT_PANE_MIGRATION_KEY)).toBe("1");
  });

  it("opens it once on a saved layout, then leaves it alone: a pane the user closed stays closed", () => {
    const store = memory();
    expect(agentPaneStartup(false, store)).toEqual({ open: true });
    expect(agentPaneStartup(false, store)).toEqual({ open: false });
    expect(agentPaneStartup(false, store)).toEqual({ open: false });
  });

  it("still opens it on a later fresh layout (another workspace), migration or not", () => {
    const store = memory();
    agentPaneStartup(false, store);
    expect(agentPaneStartup(true, store).open).toBe(true);
  });

  it("opens nothing on a saved layout when the store cannot be written: a broken store never reopens it on every launch", () => {
    expect(agentPaneStartup(false, { getItem: () => null, setItem: () => undefined }).open).toBe(false);
  });
});
