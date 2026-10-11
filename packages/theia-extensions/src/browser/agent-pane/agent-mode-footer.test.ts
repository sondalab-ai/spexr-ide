import { describe, expect, it } from "vitest";
import { lastRows, parseModeFooter } from "./agent-mode-footer.js";

const read = (...rows: string[]) => parseModeFooter(lastRows(rows));

describe("parseModeFooter", () => {
  it.each([
    ["⏸ plan mode on (shift+tab to cycle)", "plan", false],
    ["⏵⏵ accept edits on (shift+tab to cycle)", "acceptEdits", true],
    ["⏵⏵ auto mode on (shift+tab to cycle)", "auto", true],
    ["⏵⏵ bypass permissions on (shift+tab to cycle)", "bypass", true],
    ["⏵⏵ don't ask on (shift+tab to cycle)", "dontAsk", false],
    ["  ⏵⏵ accept edits on", "acceptEdits", true],
    ["⏸ plan mode", "plan", false],
  ] as const)("reads %s", (line, mode, autoApprove) => {
    expect(read("> ", line)).toEqual({ kind: "mode", mode, autoApprove });
  });

  it("is unknown when the footer is not on screen: the default mode draws none", () => {
    expect(read("? for shortcuts", "> ")).toEqual({ kind: "unknown" });
    expect(parseModeFooter([])).toEqual({ kind: "unknown" });
  });

  it("does not take prose that mentions a mode as the footer: only a row that starts with the symbol counts", () => {
    expect(read("we should use plan mode here", "the plan mode on switch is shift+tab", "> ")).toEqual({ kind: "unknown" });
    expect(read("⏺ I will enter ⏸ plan mode on now")).toEqual({ kind: "unknown" });
  });

  it("is unknown for blank bottom rows: they are skipped, and a mode above them still counts only inside the last rows", () => {
    expect(read("", "", "")).toEqual({ kind: "unknown" });
    expect(read("⏸ plan mode on", "", "")).toEqual({ kind: "mode", mode: "plan", autoApprove: false });
    expect(read("⏸ plan mode on", "a", "b", "c")).toEqual({ kind: "unknown" });
  });

  it("is unknown when a dialog covers the footer, and its 'don't ask again' option is not a mode", () => {
    expect(read("Do you want to proceed?", "❯ 1. Yes", "  2. Yes, and don't ask again for this command", "  3. No")).toEqual({ kind: "unknown" });
    expect(read("  ⏵⏵ don't ask again")).toEqual({ kind: "unknown" });
  });

  it("takes the lowest footer row, and is case-insensitive", () => {
    expect(read("⏸ plan mode on", "⏵⏵ BYPASS PERMISSIONS ON")).toEqual({ kind: "mode", mode: "bypass", autoApprove: true });
  });
});
