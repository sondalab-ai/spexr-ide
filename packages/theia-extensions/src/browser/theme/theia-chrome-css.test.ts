import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { theiaChromeCss } from "./theia-chrome-css.js";
import { ACCENT_FILL, mixBlack } from "./spexr-accent.js";
import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";

/** The value theiaChromeCss gives a `--theia-*` variable, or undefined. */
function value(theme: string, name: string): string | undefined {
  return new RegExp(`--theia-${name}:\\s*([^;]+?)\\s*!important;`).exec(theiaChromeCss(theme))?.[1];
}

/** spexr's entry in the installed kit's accent registry. */
function registeredFill(): { light: string; dark: string } {
  const effects = createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.js");
  return JSON.parse(readFileSync(join(dirname(effects), "agent/accent-registry.json"), "utf8")).products.spexr.fill;
}

// Selection was the #5b6cff accent with a white label (4.17:1 on light); it is
// the kit's tile under the primary ink (kit 0.31), in light and dark.
describe("Theia's selection", () => {
  it.each(["light", "dark"])("is the tile under the primary ink on %s", (theme) => {
    for (const name of ["list-activeSelectionBackground", "list-inactiveSelectionBackground", "quickInputList-focusBackground"]) {
      expect(value(theme, name), name).toBe("var(--slc-tile)");
    }
    for (const name of ["list-activeSelectionForeground", "list-inactiveSelectionForeground", "quickInputList-focusForeground"]) {
      expect(value(theme, name), name).toBe("var(--slc-text)");
    }
    expect(value(theme, "list-highlightForeground")).toBe("var(--slc-accent-text)");
  });

  it("is left to Theia's own high-contrast theme", () => {
    expect(value("high-contrast", "list-activeSelectionBackground")).toBeUndefined();
    expect(value("high-contrast", "quickInputList-focusBackground")).toBeUndefined();
  });
});

// A white label on the #5b6cff accent read 4.17:1; the registered fill reads 5.41.
describe("Theia's labelled fills", () => {
  it("are spexr's registered fill, the one spexr-overrides.css sets", () => {
    expect(registeredFill()).toEqual({ light: ACCENT_FILL, dark: ACCENT_FILL });
    const overrides = readFileSync(fileURLToPath(new URL("../../../../ui-kit/src/themes/spexr-overrides.css", import.meta.url)), "utf8");
    expect(overrides).toContain(`--slc-accent-fill: ${ACCENT_FILL};`);
  });

  it.each(["light", "dark", "high-contrast"])("carry the white label on the fill on %s", (theme) => {
    for (const name of ["button-background", "badge-background", "activityBarBadge-background", "menu-selectionBackground"]) {
      expect(value(theme, name), name).toBe(ACCENT_FILL);
    }
    expect(value(theme, "button-hoverBackground")).toBe(`color-mix(in srgb, ${ACCENT_FILL} 89%, black)`);
  });

  it("registers the hover the CSS mixes", () => {
    expect(mixBlack(ACCENT_FILL, 0.89)).toBe("#444ecf");
  });
});

// The status bar sits on the canvas in the muted ink, not on an accent strip.
describe("Theia's status bar", () => {
  it.each(["light", "dark"] as const)("is the canvas with the muted ink on %s", (theme) => {
    expect(value(theme, "statusBar-background")).toBe(SPEXR_NEUTRALS[theme].canvas);
    expect(value(theme, "statusBar-foreground")).toBe(SPEXR_NEUTRALS[theme].fgMuted);
  });
});
