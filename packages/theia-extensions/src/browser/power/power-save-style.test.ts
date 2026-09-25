import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OFF_SCREEN = ":not([data-sl-fx-near])";

/**
 * The kit's off-screen gate: every selector whose animation it pauses when
 * a host is far from view. It is the kit's own list of what animates, pseudo
 * elements included, so power saving must pause the same things everywhere.
 */
function kitOffScreenGate(): string[] {
  const css = readFileSync(createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.css"), "utf8");
  const block = [...css.matchAll(/([^{}]+)\{\s*animation-play-state:\s*paused !important;\s*\}/g)]
    .map((m) => m[1]!)
    .find((selectors) => selectors.includes(OFF_SCREEN));
  expect(block, "the kit's off-screen gate").toBeDefined();
  return block!
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(",\n")
    .map((s) => s.trim().replace('[data-sl-fx="on"] ', "").replaceAll(OFF_SCREEN, ""));
}

/** Selectors of spexr.css rules that pause animations while saving power. */
function powerSavePaused(): string[] {
  const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
  return [...css.matchAll(/([^{}]+)\{[^}]*animation-play-state:\s*paused !important;[^}]*\}/g)]
    .flatMap((m) => m[1]!.replace(/\/\*[\s\S]*?\*\//g, "").split(","))
    .map((s) => s.trim())
    .filter((s) => s.startsWith(":root[data-spexr-power-save] "))
    .map((s) => s.slice(":root[data-spexr-power-save] ".length));
}

// The aurora's sweeps, orbit and curtains animate on pseudo-elements, which
// `animation: none` on the host never reached: they kept moving while saving.
describe("power saving CSS", () => {
  it("pauses everything the kit pauses off-screen", () => {
    const gate = kitOffScreenGate();
    expect(gate.length).toBeGreaterThan(0);
    expect(powerSavePaused()).toEqual(expect.arrayContaining(gate));
  });
});
