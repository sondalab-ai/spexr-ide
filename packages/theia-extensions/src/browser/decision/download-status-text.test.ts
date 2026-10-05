import { describe, expect, it } from "vitest";
import { downloadStatusLive, downloadStatusText } from "./download-status-text.js";

describe("downloadStatusText", () => {
  it("says it is downloading the model, and how far it is", () => {
    expect(downloadStatusText({ model: "kev-4b", state: "downloading", received: 1, total: 3 })).toBe(
      "Downloading kev-4b 33%",
    );
  });

  // The status dock's accent dot marks the live state, so the entry carries
  // no glyph while it downloads, and its words say what is happening.
  it("is live only while downloading", () => {
    expect(downloadStatusLive({ model: "kev-4b", state: "downloading" })).toBe(true);
    for (const state of ["failed", "ready", "off", "missing", "waiting"] as const) {
      expect(downloadStatusLive({ model: "kev-4b", state }), state).toBe(false);
    }
  });

  it("says when the download failed", () => {
    expect(downloadStatusText({ model: "kev-4b", state: "failed" })).toBe("$(warning) kev-4b not downloaded");
  });

  it("shows nothing once the model is ready, off, missing or still waiting to start", () => {
    for (const state of ["ready", "off", "missing", "waiting"] as const) {
      expect(downloadStatusText({ model: "kev-4b", state })).toBeUndefined();
    }
  });
});
