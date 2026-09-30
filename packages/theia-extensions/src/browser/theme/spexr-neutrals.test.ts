import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";

/** Reads one `--sl-*` token from the installed kit's generated theme file. */
function kitToken(theme: "light" | "dark", name: string): string {
  const css = readFileSync(createRequire(import.meta.url).resolve(`@sondalab/ui-kit/themes/${theme}.css`), "utf8");
  const value = new RegExp(`--sl-${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
  if (!value) throw new Error(`--sl-${name} not found in themes/${theme}.css`);
  return value.toUpperCase();
}

/** Solid colour of `rgba(r,g,b,a)` painted over an opaque `#RRGGBB`, rounded per channel. */
function composite(rgba: string, over: string): string {
  const [r, g, b, a] = rgba.match(/[\d.]+/g)!.map(Number) as [number, number, number, number];
  const base = [1, 3, 5].map((i) => parseInt(over.slice(i, i + 2), 16));
  return `#${[r, g, b].map((c, i) => Math.round(base[i]! + (c - base[i]!) * a).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

// SPEXR_NEUTRALS copies the kit's neutrals into Theia's variables and colour
// registry; a kit bump that moves a neutral must move the copy with it.
describe("SPEXR_NEUTRALS", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`matches the kit's ${theme} neutrals`, () => {
      const n = SPEXR_NEUTRALS[theme];
      expect({ canvas: n.canvas, surface: n.surface, raised: n.raised, fg: n.fg, fgMuted: n.fgMuted }).toEqual({
        canvas: kitToken(theme, "bg-canvas"),
        surface: kitToken(theme, "bg-surface"),
        raised: kitToken(theme, "bg-surface-raised"),
        fg: kitToken(theme, "text-primary"),
        fgMuted: kitToken(theme, "text-muted"),
      });
    });
  }

  it("light line is the kit's default border over the surface", () => {
    expect(SPEXR_NEUTRALS.light.line).toBe(composite(kitToken("light", "border-default"), SPEXR_NEUTRALS.light.surface));
  });
});
