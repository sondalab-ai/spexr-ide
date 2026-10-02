import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { SPEXR_NEUTRALS, solidOver } from "./spexr-neutrals.js";

type Roles = Record<string, string>;

/** spexr's generated neutrals for one theme, read from the installed kit's neutrals.json. */
function kitRoles(theme: "light" | "dark"): Roles {
  const json = JSON.parse(readFileSync(createRequire(import.meta.url).resolve("@sondalab/ui-kit/neutrals.json"), "utf8"));
  const roles = json.products?.spexr?.[theme] as Roles | undefined;
  if (!roles) throw new Error(`products.spexr.${theme} not found in neutrals.json`);
  return roles;
}

/** A file of the desktop app, which carries the literals that cannot import the JSON. */
const desktopFile = (name: string): string =>
  readFileSync(new URL(`../../../../../apps/desktop/${name}`, import.meta.url), "utf8");

// SPEXR_NEUTRALS feeds Theia's variables and colour registry from the kit's
// generated spexr ladder; it must say exactly what products.css says.
describe("SPEXR_NEUTRALS", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`is the kit's generated spexr ${theme} neutrals`, () => {
      const n = SPEXR_NEUTRALS[theme];
      const k = kitRoles(theme);
      expect({ canvas: n.canvas, surface: n.surface, raised: n.raised, fg: n.fg, fgMuted: n.fgMuted }).toEqual({
        canvas: k["bg-canvas"],
        surface: k["bg-surface"],
        raised: k["bg-surface-raised"],
        fg: k["text-primary"],
        fgMuted: k["text-muted"],
      });
    });

    it(`${theme} line is the kit's default border over the surface`, () => {
      const k = kitRoles(theme);
      expect(SPEXR_NEUTRALS[theme].line).toBe(solidOver(k["border-default"]!, k["bg-surface"]!));
    });
  }

  it("composites a translucent ink over a solid ground", () => {
    expect(solidOver("rgba(0,0,0,0.5)", "#ffffff")).toBe("#808080");
    expect(solidOver("rgba(255,255,255,0)", "#102030")).toBe("#102030");
  });
});

// Build-time literals that cannot import neutrals.json: the anti-flash preload
// (a static template injected into index.html) and the Electron window's
// configured background. Kept in sync by hand; these pin them to the kit.
describe("the desktop app's literal canvas", () => {
  it("preload.html paints the kit's spexr canvas for each theme", () => {
    const html = desktopFile("preload.html");
    const literal = /var canvas = theme === 'light' \? '(#[0-9a-f]{6})' : '(#[0-9a-f]{6})';/.exec(html);
    expect(literal, "the canvas literal in preload.html").not.toBeNull();
    expect({ light: literal![1], dark: literal![2] }).toEqual({
      light: kitRoles("light")["bg-canvas"],
      dark: kitRoles("dark")["bg-canvas"],
    });
  });

  it("preload.html selects the spexr product next to the theme", () => {
    expect(desktopFile("preload.html")).toMatch(/root\.setAttribute\('data-sl-product', 'spexr'\);/);
  });

  it("the Electron window starts on the kit's spexr dark canvas", () => {
    const manifest = JSON.parse(desktopFile("package.json"));
    expect(manifest.theia.frontend.config.electron.windowOptions.backgroundColor).toBe(kitRoles("dark")["bg-canvas"]);
  });
});
