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

/** Selectors of spexr.css rules that pause animations under the given root flag. */
function pausedUnder(flag: string): string[] {
  const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
  return [...css.matchAll(/([^{}]+)\{[^}]*animation-play-state:\s*paused !important;[^}]*\}/g)]
    .flatMap((m) => m[1]!.replace(/\/\*[\s\S]*?\*\//g, "").split(","))
    .map((s) => s.trim())
    .filter((s) => s.startsWith(`${flag} `))
    .map((s) => s.slice(flag.length + 1));
}

// The aurora's sweeps, orbit and curtains animate on pseudo-elements, which
// `animation: none` on the host never reached: they kept moving while saving.
describe("power saving CSS", () => {
  it("pauses everything the kit pauses off-screen", () => {
    const gate = kitOffScreenGate();
    expect(gate.length).toBeGreaterThan(0);
    expect(pausedUnder(":root[data-spexr-power-save]")).toEqual(expect.arrayContaining(gate));
  });
});

// Idle or unfocused windows (motion-idle.ts) freeze decorative loops in place,
// so they resume where they were; status animations are not in this list.
describe("paused motion CSS", () => {
  const paused = (): string[] => pausedUnder(':root[data-spexr-motion="paused"]');

  it("freezes everything the kit pauses off-screen", () => {
    expect(paused()).toEqual(expect.arrayContaining(kitOffScreenGate()));
  });

  it("freezes SPEXR's own decorative loops", () => {
    expect(paused()).toEqual(
      expect.arrayContaining([
        ".spexr-welcome-bg__blob::before",
        ".spexr-smart-search__map-cta",
        ".spexr-smart-search__map-glyph",
      ]),
    );
  });
});

/** Declarations of every spexr.css rule whose selector list names `selector`. */
function declarationsFor(selector: string): string {
  const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => m[1]!.replace(/\/\*[\s\S]*?\*\//g, "").split(",").some((s) => s.trim() === selector))
    .map((m) => m[2]!)
    .join("\n");
}

// The welcome backdrop is five 42vmax blobs blurred by 70px under a 60px
// backdrop blur: stilling the drift left both filters repainting.
describe("power saving the welcome background", () => {
  it("drops the blurred blobs", () => {
    expect(declarationsFor(":root[data-spexr-power-save] .spexr-welcome-bg__blob")).toMatch(/display:\s*none/);
  });

  it("keeps the veil's tint but not its backdrop blur", () => {
    const veil = declarationsFor(":root[data-spexr-power-save] .spexr-welcome-bg::after");
    expect(veil).toMatch(/backdrop-filter:\s*none/);
    expect(veil).not.toMatch(/background:\s*none/);
  });
});
