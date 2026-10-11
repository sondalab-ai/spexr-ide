import { describe, expect, it } from "vitest";
import { parseModeFooter } from "./agent-mode-footer.js";

describe("parseModeFooter", () => {
  it.each([
    ["⏸ plan mode on (shift+tab to cycle)", "plan", false],
    ["⏵⏵ accept edits on (shift+tab to cycle)", "acceptEdits", true],
    ["⏵⏵ auto mode on (shift+tab to cycle)", "auto", true],
    ["⏵⏵ bypass permissions on (shift+tab to cycle)", "bypass", true],
    ["manual mode on", "manual", false],
    ["don't ask on", "dontAsk", false],
    ["Don’t ask", undefined, false],
  ] as const)("reads %s", (line, mode, autoApprove) => {
    const got = parseModeFooter(["", line, ""]);
    expect(got?.mode).toBe(mode);
    if (mode) expect(got?.autoApprove).toBe(autoApprove);
  });

  it("is unknown when no indicator is on screen, and never claims a mode", () => {
    expect(parseModeFooter([])).toBeUndefined();
    expect(parseModeFooter(["? for shortcuts", "> "])).toBeUndefined();
  });

  it("takes the lowest line with an indicator, so the conversation's own words above the footer do not count", () => {
    expect(parseModeFooter(["we discussed plan mode earlier", "⏵⏵ accept edits on"])?.mode).toBe("acceptEdits");
    expect(parseModeFooter(["⏵⏵ bypass permissions on", "we should use plan mode here"])?.mode).toBe("plan");
  });

  it("is case-insensitive", () => {
    expect(parseModeFooter(["BYPASS PERMISSIONS ON"])?.autoApprove).toBe(true);
  });
});
