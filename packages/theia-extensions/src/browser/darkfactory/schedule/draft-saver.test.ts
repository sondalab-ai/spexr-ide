import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftSaver } from "./draft-saver.js";

describe("DraftSaver", () => {
  let saved: string[];
  let saver: DraftSaver<string>;
  beforeEach(() => {
    vi.useFakeTimers();
    saved = [];
    saver = new DraftSaver<string>((d) => void saved.push(d), 600);
  });
  afterEach(() => vi.useRealTimers());

  it("saves the latest edit once typing pauses", () => {
    saver.edit("a");
    saver.edit("ab");
    vi.advanceTimersByTime(599);
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(saved).toEqual(["ab"]);
  });

  it("flush saves a pending edit at once, and only once", () => {
    saver.edit("a");
    saver.flush();
    saver.flush();
    vi.advanceTimersByTime(1000);
    expect(saved).toEqual(["a"]);
  });

  it("dispose (the pane closing) saves an edit made moments before, instead of losing it", () => {
    saver.edit("typed");
    vi.advanceTimersByTime(100);
    saver.dispose();
    vi.advanceTimersByTime(1000);
    expect(saved).toEqual(["typed"]);
  });

  it("dispose with nothing pending saves nothing", () => {
    saver.edit("a");
    vi.advanceTimersByTime(600);
    saver.dispose();
    expect(saved).toEqual(["a"]);
  });

  it("discard then dispose saves nothing: a deleted schedule's draft is never resurrected", () => {
    saver.edit("deleted");
    saver.discard();
    saver.dispose();
    vi.advanceTimersByTime(1000);
    expect(saved).toEqual([]);
  });
});
