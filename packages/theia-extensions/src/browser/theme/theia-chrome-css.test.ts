import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { theiaChromeCss } from "./theia-chrome-css.js";
import { ACCENT, ACCENT_FILL, fillStep } from "./spexr-accent.js";
import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";

/** The value theiaChromeCss gives a `--theia-*` variable, or undefined. */
function value(theme: string, name: string): string | undefined {
  return new RegExp(`--theia-${name}:\\s*([^;]+?)\\s*!important;`).exec(theiaChromeCss(theme))?.[1];
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
});

// The accent as text was #5b6cff on light: 3.37:1 on the canvas, 4.03 on the
// surface. The kit's accent-as-text role caps it there (and is the accent on dark).
describe("Theia's accent as text", () => {
  it.each(["light", "dark"])("is the kit's accent-text role on %s", (theme) => {
    for (const name of [
      "button-secondaryForeground",
      "textLink-foreground",
      "editorLink-activeForeground",
      "inputOption-activeForeground",
      "gitDecoration-addedResourceForeground",
      "pickerGroup-foreground",
    ]) {
      expect(value(theme, name), name).toBe("var(--slc-accent-text)");
    }
  });

  it("steps a hovered link one shade further from its ground", () => {
    const step = "var(--slc-shade-step, 0.075)";
    expect(value("light", "textLink-activeForeground")).toBe(`oklch(from var(--slc-accent-text) calc(l - ${step}) calc(c * max(0, 1 - ${step} / max(l, 0.001))) h)`);
    expect(value("dark", "textLink-activeForeground")).toBe(`oklch(from var(--slc-accent-text) calc(l + ${step}) calc(c * pow(max(0, 1 - ${step} / max(1 - l, 0.001)), 1.5)) h)`);
  });
});

// A white label on the #5b6cff accent read 4.17:1; the registered fill reads 5.41.
describe("Theia's labelled fills", () => {
  it("are spexr's registered fill, the one spexr-overrides.css sets", () => {
    const overrides = readFileSync(fileURLToPath(new URL("../../../../ui-kit/src/themes/spexr-overrides.css", import.meta.url)), "utf8");
    expect(ACCENT_FILL.dark).toBe(ACCENT_FILL.light);
    expect(overrides).toContain(`--slc-accent-fill: ${ACCENT_FILL.light};`);
  });

  it.each(["light", "dark"] as const)("carry the white label on the fill on %s", (theme) => {
    for (const name of ["button-background", "badge-background", "activityBarBadge-background", "menu-selectionBackground"]) {
      expect(value(theme, name), name).toBe(ACCENT_FILL[theme]);
    }
    expect(value(theme, "button-hoverBackground")).toBe(fillStep(ACCENT_FILL[theme], "hover"));
  });
});

// The status bar sits on the canvas in the muted ink, not on an accent strip.
// The accent and its wash come from the kit's accent registry, not literals.
describe("Theia's accent", () => {
  it.each(["light", "dark"] as const)("is the registry's accent on %s", (theme) => {
    expect(value(theme, "focusBorder")).toBe(ACCENT[theme]);
    expect(value(theme, "button-secondaryBackground")).toBe(`color-mix(in srgb, ${ACCENT[theme]} ${theme === "dark" ? 12 : 10}%, transparent)`);
  });
});

describe("Theia's status bar", () => {
  it.each(["light", "dark"] as const)("is the canvas with the muted ink on %s", (theme) => {
    expect(value(theme, "statusBar-background")).toBe(SPEXR_NEUTRALS[theme].canvas);
    expect(value(theme, "statusBar-foreground")).toBe(SPEXR_NEUTRALS[theme].fgMuted);
  });
});

// The main area's tabs are tile tabs drawn in spexr.css; the colours Theia's
// own tab rules read there are no longer set.
describe("the editor tabs' Theia colours", () => {
  it.each(["light", "dark"])("are not injected on %s", (theme) => {
    for (const name of ["tab-activeBorderTop", "tab-unfocusedActiveBorderTop", "tab-activeBackground", "tab-hoverBackground", "tab-inactiveBackground", "tab-border"]) {
      expect(value(theme, name), name).toBeUndefined();
    }
  });
});

// High contrast keeps Theia's own HC colours and the kit's yellow: the
// injection there is the UI face only, no indigo fill, no light accent.
describe("high contrast", () => {
  it("gets the UI face and nothing else", () => {
    const vars = [...theiaChromeCss("high-contrast").matchAll(/--theia-([\w-]+):/g)].map((m) => m[1]);
    expect(vars).toEqual(["ui-font-family"]);
  });
});
