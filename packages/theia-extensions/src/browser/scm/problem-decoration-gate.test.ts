import { describe, expect, it } from "vitest";
import { gateProblemDecoration } from "./problem-decoration-gate.js";

describe("the problem marks' gate (S6b, L7)", () => {
  it("returns nothing while the preference is off, and does not ask the provider", () => {
    let asked = 0;
    expect(gateProblemDecoration(false, () => (asked++, { letter: "1", bubble: true }))).toBeUndefined();
    expect(asked).toBe(0);
  });

  it("returns the provider's decoration while it is on, and follows the preference as it changes", () => {
    const prefs = { enabled: true };
    const provide = () => ({ letter: "1", bubble: true });
    expect(gateProblemDecoration(prefs.enabled, provide)).toEqual({ letter: "1", bubble: true });
    prefs.enabled = false;
    expect(gateProblemDecoration(prefs.enabled, provide)).toBeUndefined();
  });

  it("passes a missing decoration through", () => {
    expect(gateProblemDecoration<undefined>(true, () => undefined)).toBeUndefined();
  });
});
