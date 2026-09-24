import { describe, expect, it } from "vitest";
import { downloadStatusText } from "./download-status-text.js";

describe("downloadStatusText", () => {
  it("shows the model and how far its download is", () => {
    expect(downloadStatusText({ model: "kev-4b", state: "downloading", received: 1, total: 3 })).toBe(
      "$(cloud-download) kev-4b 33%",
    );
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
