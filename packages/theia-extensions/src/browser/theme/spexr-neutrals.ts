import kitNeutrals from "@sondalab/ui-kit/neutrals.json";

/**
 * The SPEXR surface neutrals, per theme variant.
 *
 * Shared because two layers need the same values from different directions:
 * `SpexrThemeContribution` writes them into Theia's `--theia-*` CSS variables,
 * while `SpexrColorContribution` must register some of them in the *color
 * registry* — colors that reach a canvas rather than a DOM node (xterm's
 * background) are read from the registry in JavaScript and never see the CSS
 * override. High contrast is left to Theia's own HC theme.
 *
 * Read from the kit's generated `neutrals.json` (`products.spexr`), the same
 * values `themes/products.css` gives `--sl-*` under `data-sl-product="spexr"`,
 * so Theia's chrome and the SPEXR panels share one indigo-tinted ladder.
 */
export interface SpexrNeutrals {
  /** Deepest — the frame behind the islands: activity bar, status bar, the terminal's well. */
  canvas: string;
  /** An island at rest: sidebar, panels, editor (spexr.css re-binds them on each island). */
  surface: string;
  /** Menus, dropdowns, widgets, inputs. */
  raised: string;
  fg: string;
  fgMuted: string;
  /** Solid border matching the surfaces. */
  line: string;
}

type ThemeKind = "light" | "dark";

/**
 * Solid `#rrggbb` of an `rgba(r,g,b,a)` colour painted over an opaque `#rrggbb`
 * ground, rounded per channel. Theia's border variables want one solid colour,
 * while the kit's borders are translucent ink over whatever surface they sit on.
 */
export function solidOver(rgba: string, ground: string): string {
  const [r, g, b, a] = (rgba.match(/[\d.]+/g) ?? []).map(Number);
  if (r === undefined || g === undefined || b === undefined || a === undefined) {
    throw new Error(`not an rgba() colour: ${rgba}`);
  }
  const base = [1, 3, 5].map((i) => parseInt(ground.slice(i, i + 2), 16));
  return `#${[r, g, b]
    .map((c, i) => Math.round(base[i]! + (c - base[i]!) * a).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** SPEXR's generated neutral roles for one theme, in the shape Theia's layers read. */
function neutralsFor(theme: ThemeKind): SpexrNeutrals {
  const role = kitNeutrals.products.spexr[theme];
  return {
    canvas: role["bg-canvas"],
    surface: role["bg-surface"],
    raised: role["bg-surface-raised"],
    fg: role["text-primary"],
    fgMuted: role["text-muted"],
    line: solidOver(role["border-default"], role["bg-surface"]),
  };
}

export const SPEXR_NEUTRALS: { dark: SpexrNeutrals; light: SpexrNeutrals } = {
  dark: neutralsFor("dark"),
  light: neutralsFor("light"),
};
