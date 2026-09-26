import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The declarations of the first rule whose selector is exactly `selector` in spexr.css. */
function rule(selector: string): string {
  const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

// The live light's brightest band sits just inside a working card's border,
// under its children. A header bar bled out to the card's edge covered that
// band along both sides of the header, so the glow looked notched there.
describe(".spexr-df-pinned__bar", () => {
  it("stays at least 10px inside the card's sides", () => {
    const bar = rule(".spexr-df-pinned__bar");
    const inset = bar.match(/--df-pinned-bar-inset:\s*(\d+)px/);
    expect(inset, "the bar declares its inset").not.toBeNull();
    expect(Number(inset![1])).toBeGreaterThanOrEqual(10);
    expect(bar).toMatch(/margin:[^;]*calc\(var\(--df-pinned-bar-inset\) - var\(--sl-space-4\)\)/);
  });
});

// The kit draws the live light under its host's children. The pinned card's
// opaque sticky bar and terminal box covered it: no light along the top edge,
// and a hard dark rectangle cut out of its inner fade.
describe("the pinned card's live light", () => {
  it("sits above the sticky bar", () => {
    const zOf = (block: string): number => Number(block.match(/z-index:\s*(-?\d+)/)![1]);
    const bar = zOf(rule(".spexr-df-pinned__bar"));
    const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
    const light = css.match(
      /\.spexr-df-pinned\.sl-fx-aurora > \.sl-fx-live__canvas,\s*\.spexr-df-pinned\.sl-fx-aurora::after \{([^}]*)\}/,
    );
    expect(light, "a rule lifts both the canvas and the ring").not.toBeNull();
    expect(zOf(light![1])).toBeGreaterThan(bar);
  });
});

// Leaving "working" swapped a moving accent light for a grey label and a plain
// edge at once, which read as the card changing colour.
describe("a card leaving working", () => {
  const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");

  it("fades the live light in instead of switching it on", () => {
    const rule = css.match(/:is\(\.spexr-df-card, \.spexr-df-pinned\)\.sl-fx-aurora > \.sl-fx-live__canvas \{([^}]*)\}/);
    expect(rule, "a rule animates the light's canvas").not.toBeNull();
    const name = rule![1]!.match(/animation:\s*([\w-]+)/)![1]!;
    expect(css).toMatch(new RegExp(`@keyframes ${name} \\{\\s*from \\{ opacity: 0; \\}`));
  });

  it("keeps the card's colour in its idle label", () => {
    expect(rule('.spexr-df-card__status[data-kind="idle"]')).toMatch(/var\(--tile-accent\)/);
  });

  it("keeps a trace of the colour on a resting tile's edge, but not over waiting or failed", () => {
    const resting = css.match(/\.spexr-df-card\.sl-fx-aurora:not\(([^)]*)\) \{([^}]*)\}/);
    expect(resting).not.toBeNull();
    expect(resting![1]).toContain('[data-status="attn"]');
    expect(resting![1]).toContain('[data-status="error"]');
    expect(resting![2]).toMatch(/border-color:[^;]*var\(--tile-accent\)/);
  });
});
