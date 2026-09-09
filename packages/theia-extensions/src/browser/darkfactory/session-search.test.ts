import { describe, expect, it, vi } from "vitest";
import { SessionSearchState } from "./session-search.js";

describe("SessionSearchState", () => {
  it("issues one query per debounce window, with the latest text", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => []);
    const state = new SessionSearchState();
    state.setQuery("des", run);
    state.setQuery("design sys", run);
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("design sys");
    vi.useRealTimers();
  });

  it("repaints through the callback when results are accepted", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const state = new SessionSearchState(onChange);
    state.setQuery("design", async () => []);
    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("discards a result whose query was superseded", () => {
    const state = new SessionSearchState();
    const stale = state.token();
    state.setQuery("newer", async () => []);
    state.accept(stale, [{ tile: { sessionId: "a" }, score: 1, archived: false } as never]);
    expect(state.hits).toEqual([]);
  });

  it("clears without issuing a query", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => []);
    const state = new SessionSearchState();
    state.setQuery("design", run);
    state.clear();
    await vi.advanceTimersByTimeAsync(300);
    expect(run).not.toHaveBeenCalled();
    expect(state.query).toBe("");
    expect(state.hits).toEqual([]);
    vi.useRealTimers();
  });

  it("treats a whitespace-only query as empty", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => []);
    const state = new SessionSearchState();
    state.setQuery("   ", run);
    await vi.advanceTimersByTimeAsync(300);
    expect(run).not.toHaveBeenCalled();
    expect(state.active).toBe(false);
    vi.useRealTimers();
  });
});
