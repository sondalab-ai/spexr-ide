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

  it("leaves the kit's loops to the kit's still flag", () => {
    const css = readFileSync(createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.css"), "utf8");
    expect(css).toMatch(/:root\[data-sl-fx-still\] :is\(\.sl-fx-aurora, \.sl-fx-aurora__glow, \.sl-fx-glass\)::before/);
    expect(paused().filter((s) => s.includes(".sl-fx-"))).toEqual([]);
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

// Ink was dropped only inside live cards (their data-sl-fx="off") and kept
// running on every other button while saving.
describe("power saving the ink hover", () => {
  it("drops the ink layer on every button", () => {
    expect(declarationsFor(":root[data-spexr-power-save] .sl-fx-ink")).toMatch(/display:\s*none/);
  });
});

// Saving killed every effect host's box-shadow, and with it a selected tile's
// only marker, a glass control's own depth (a secondary's lit line and cast)
// and its focus halo. The kit restores them after its own kill switches (the
// selection 0.31, a control's depth and halo 0.32), and a surface's own
// recipe, an island's ring or an overlay's cast (0.33; the cast, which
// carries a toast's and a palette's ring, since 0.34); saving mirrors every
// restore, list for list, under spexr's flag.
describe("power saving keeps the selection, a control's depth and focus halo, and a surface's recipe", () => {
  const kit = readFileSync(createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.css"), "utf8");
  const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
  const restores = [
    ...kit.matchAll(/:is\(\[data-sl-fx="off"\], \[data-sl-fx="off"\] \*\)(:is\([^{]*?)\s*\{\s*box-shadow:\s*(var\(--(?:_sl-depth|slc-depth-)[^;]*);/g),
  ];

  it("finds the kit's selection, depth, halo, island and cast restores", () => {
    expect(restores.map(([, , shadow]) => shadow!.split(/[,)]/)[0])).toEqual([
      "var(--slc-depth-tile",
      "var(--slc-depth-flat",
      "var(--_sl-depth",
      "var(--_sl-depth",
      "var(--slc-depth-island",
      "var(--slc-depth-cast",
    ]);
  });

  it.each(restores.map(([, rest, shadow]) => [rest!, shadow!]))("mirrors %s", (rest, shadow) => {
    const at = css.indexOf(`:root[data-spexr-power-save] ${rest} {`);
    expect(at, "the restore under data-spexr-power-save").toBeGreaterThanOrEqual(0);
    expect(css.slice(at, css.indexOf("}", at))).toContain(`box-shadow: ${shadow};`);
  });
});

// The status bar's live dot (kit 0.34) breathes on its own, not as an effect:
// the kit stops it in a data-sl-fx="off" region and pauses it under
// data-sl-fx-still, and power saving sets neither on the root, so a dot of
// the kit's kept breathing while saving.
describe("power saving the status bar's live dot", () => {
  it("stops it as the kit stops it in an opt-out region", () => {
    const kit = readFileSync(createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.css"), "utf8");
    expect(kit).toMatch(/\[data-sl-fx="off"\] \.sl-statusbar__dot,[^{]*\{\s*animation:\s*none !important;\s*\}/);
    expect(declarationsFor(":root[data-spexr-power-save] .sl-statusbar__dot")).toMatch(/animation:\s*none !important;/);
  });
});
