import { describe, expect, it } from "vitest";
import { isUnattended } from "./schedule-types.js";

describe("isUnattended", () => {
  it("flags claude's auto-approving modes", () => {
    expect(isUnattended("claude", "auto")).toBe(true);
    expect(isUnattended("claude", "bypassPermissions")).toBe(true);
  });
  it("leaves claude's other modes alone", () => {
    expect(isUnattended("claude", "acceptEdits")).toBe(false);
    expect(isUnattended("claude", "plan")).toBe(false);
    expect(isUnattended("claude", "dontAsk")).toBe(false);
    expect(isUnattended("claude", "manual")).toBe(false);
  });
  it("flags opencode's only mode", () => {
    expect(isUnattended("opencode", "auto")).toBe(true);
  });
  it("is false with no mode set", () => {
    expect(isUnattended("claude", undefined)).toBe(false);
  });
});
