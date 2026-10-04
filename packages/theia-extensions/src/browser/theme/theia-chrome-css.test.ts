import { describe, expect, it } from "vitest";
import { theiaChromeCss } from "./theia-chrome-css.js";

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

  it("is left to Theia's own high-contrast theme", () => {
    expect(value("high-contrast", "list-activeSelectionBackground")).toBeUndefined();
    expect(value("high-contrast", "quickInputList-focusBackground")).toBeUndefined();
  });
});
