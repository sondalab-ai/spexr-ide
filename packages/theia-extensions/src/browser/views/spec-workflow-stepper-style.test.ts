import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// The stepper's buttons were hand-drawn chips and badges with their own fills,
// borders and shadows, so the Spec view never looked like the rest of the kit.
describe("spec workflow stepper buttons", () => {
  const source = read("./spec-workflow-stepper.tsx");
  const buttons = source.split("<button").slice(1).map((b) => b.slice(0, b.indexOf(">")));

  it("renders every button as a kit button", () => {
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) expect(b).toMatch(/className=[^\n]*\bsl-(icon-)?btn\b/);
  });

  it("leaves the buttons' fill, border and shadow to the kit", () => {
    const css = read("../style/spexr.css");
    const rules = css.match(/[^{}]*\.spexr-stepper__(btn|action)[^{}]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).not.toMatch(/\b(background|border|box-shadow)\s*:/);
  });
});
