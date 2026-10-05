import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The installed @sondalab/ui-kit version; its package.json is not exported, so find it beside a file that is. */
function installedKitVersion(): string {
  const effects = createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.js");
  return JSON.parse(readFileSync(join(dirname(effects), "package.json"), "utf8")).version;
}

describe("@sondalab/ui-kit", () => {
  // 0.33.0 ships workbench.css, whose lit pane (.sl-pane[data-lit]) the
  // shell's islands wear, and the seam on every selected or current tile.
  // 0.32.1 ships the one label threshold and the hover/press step rule the
  // registry's fill hover is derived with (spexr-accent.ts) and the glass
  // primary's shade under a white label. 0.32.0 ships the --slc-accent-fill role spexr's registered fill is set
  // through, the kit's danger tone (spexr's own was deleted), the focus halo
  // and its restore after the effects kill switches; 0.31.0 the depth roles
  // (--slc-tile, --slc-depth-*) the Theia chrome is drawn with. 0.30.0 ships
  // Geist / Geist Mono and the micro register (--sl-text-micro)
  // spexr's structural labels read; 0.29.0 the per-product neutrals
  // (themes/products.css, neutrals.json) that SPEXR_NEUTRALS and the
  // data-sl-product attribute select. 0.25.0 gives every control its press,
  // 0.24.0 carries accent text in --slc-accent-text, 0.23 shipped the list,
  // disclosure and resizer, and 0.22 the segmented aria-pressed paint.
  it("is at least 0.33.0", () => {
    const [major, minor, patch] = installedKitVersion().split(".").map(Number) as [number, number, number];
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(33_000);
  });
});
