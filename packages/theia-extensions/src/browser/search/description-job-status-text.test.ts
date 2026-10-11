import { describe, expect, it } from "vitest";
import { descriptionJobStatusText } from "./description-job-status-text.js";

describe("descriptionJobStatusText", () => {
  // A running job is live: the status dock's accent dot marks it, so it
  // carries no glyph of its own (one mark per state).
  it("shows a running job's progress as a live state, with no glyph", () => {
    expect(descriptionJobStatusText({ state: "running", done: 12, total: 40 })).toEqual({ text: "Understanding 12/40", live: true });
  });

  it("keeps the glyph on a paused or failed job, which is not live", () => {
    expect(descriptionJobStatusText({ state: "paused", done: 12, total: 40 })).toEqual({
      text: "$(debug-pause) Understanding paused 12/40",
      live: false,
    });
    expect(descriptionJobStatusText({ state: "error", done: 0, total: 40, message: "x" })).toEqual({
      text: "$(error) Understanding failed",
      live: false,
    });
  });

  it("hides the entry while idle or complete", () => {
    expect(descriptionJobStatusText({ state: "idle", done: 0, total: 0 })).toBeUndefined();
    expect(descriptionJobStatusText({ state: "complete", done: 40, total: 40 })).toBeUndefined();
  });
});
