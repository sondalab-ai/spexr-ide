import { describe, expect, it } from "vitest";
import { DRAFT_SAVE_MS, DraftKeeper, agentDraftKey, type DraftStorage } from "./agent-pane-draft.js";

function make(initial: Record<string, string> = {}): { keeper: DraftKeeper; store: Record<string, string>; changes: { n: number }; fire: () => void; pending: () => number } {
  const store = { ...initial };
  const storage: DraftStorage = {
    get: async (k) => store[k],
    set: async (k, v) => void (store[k] = v),
  };
  const changes = { n: 0 };
  let queued: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const timers = {
    set: (fn: () => void, ms: number) => {
      const t = { fn, ms, live: true };
      queued.push(t);
      return t as unknown as ReturnType<typeof setTimeout>;
    },
    clear: (t: ReturnType<typeof setTimeout>) => void ((t as unknown as { live: boolean }).live = false),
  };
  const keeper = new DraftKeeper(storage, () => void changes.n++, timers);
  return { keeper, store, changes, fire: () => queued.filter((t) => t.live).forEach((t) => ((t.live = false), t.fn())), pending: () => queued.filter((t) => t.live).length };
}

describe("DraftKeeper", () => {
  it("loads a workspace's saved draft into an empty field", async () => {
    const { keeper } = make({ [agentDraftKey("file:///a")]: "saved" });
    await keeper.switchRoot("file:///a");
    expect(keeper.text).toBe("saved");
  });

  it("keeps what was typed before the first root was known, over the saved draft", async () => {
    const { keeper } = make({ [agentDraftKey("file:///a")]: "saved" });
    keeper.set("typed early");
    await keeper.switchRoot("file:///a");
    expect(keeper.text).toBe("typed early");
  });

  it("clears the field on a switch to another root, and never saves one workspace's text under another's", async () => {
    const { keeper, store } = make({ [agentDraftKey("file:///b")]: "b's draft" });
    await keeper.switchRoot("file:///a");
    keeper.set("a's words");
    await keeper.switchRoot("file:///b");
    expect(keeper.text).toBe("b's draft");
    expect(store[agentDraftKey("file:///a")]).toBe("a's words");
    keeper.flush();
    expect(store[agentDraftKey("file:///b")]).toBe("b's draft");
  });

  it("starts empty on a switch to a root with no saved draft", async () => {
    const { keeper } = make();
    await keeper.switchRoot("file:///a");
    keeper.set("a's words");
    await keeper.switchRoot("file:///b");
    expect(keeper.text).toBe("");
  });

  it("ignores the same root again and an unknown root", async () => {
    const { keeper, changes } = make();
    await keeper.switchRoot("file:///a");
    keeper.set("x");
    const n = changes.n;
    await keeper.switchRoot("file:///a");
    await keeper.switchRoot(undefined);
    expect(keeper.text).toBe("x");
    expect(changes.n).toBe(n);
  });

  it("clears after a send only when the field still holds what was sent: text typed during the paste survives", async () => {
    const { keeper } = make();
    await keeper.switchRoot("file:///a");
    keeper.set("send this");
    expect(keeper.clearIfUnchanged("send this")).toBe(true);
    expect(keeper.text).toBe("");
    keeper.set("send this");
    keeper.set("send this, and more typed meanwhile");
    expect(keeper.clearIfUnchanged("send this")).toBe(false);
    expect(keeper.text).toBe("send this, and more typed meanwhile");
  });

  it("saves shortly after the last keystroke, once", async () => {
    const { keeper, store, fire, pending } = make();
    await keeper.switchRoot("file:///a");
    keeper.set("a");
    keeper.set("ab");
    expect(pending()).toBe(1);
    expect(store[agentDraftKey("file:///a")]).toBeUndefined();
    fire();
    expect(store[agentDraftKey("file:///a")]).toBe("ab");
    expect(DRAFT_SAVE_MS).toBeGreaterThan(0);
  });

  it("writes the draft back at once on dispose", async () => {
    const { keeper, store, pending } = make();
    await keeper.switchRoot("file:///a");
    keeper.set("unsaved");
    keeper.dispose();
    expect(store[agentDraftKey("file:///a")]).toBe("unsaved");
    expect(pending()).toBe(0);
  });
});
