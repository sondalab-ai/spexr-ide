import { describe, expect, it } from "vitest";
import { colorsName } from "./decoration-name-colour.js";
import { decorationForFile } from "./git-state-decoration-format.js";

describe("which decorations colour a row's name (S6b, L7)", () => {
  it("leaves the name of a changed file in the row's ink: every git state's colour is the letter's alone", () => {
    for (const state of ["A", "M", "D", "R", "C", "U", "?"] as const) {
      const decoration = decorationForFile({ path: "f.ts", unstagedState: state });
      expect(decoration?.colorId, state).toBeDefined();
      expect(colorsName(decoration?.colorId), state).toBe(false);
    }
  });

  it("keeps the dimming of an ignored name, which has no letter to carry it", () => {
    expect(colorsName("disabledForeground")).toBe(true);
  });

  it("colours nothing for a decoration without a colour", () => {
    expect(colorsName(undefined)).toBe(false);
  });
});
