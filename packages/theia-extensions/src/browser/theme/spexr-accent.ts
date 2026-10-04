import kitAccents from "@sondalab/ui-kit/agent/accent-registry.json";

type ThemeKind = "light" | "dark";
type PerTheme = { light: string; dark: string };

const spexr = kitAccents.products.spexr;

/** SPEXR's accent, per theme, from the kit's accent registry (`products.spexr`). */
export const ACCENT: PerTheme = { light: spexr.light, dark: spexr.dark };

/**
 * SPEXR's registered accent fill, per theme, from the kit's accent registry
 * (`products.spexr.fill`), the value spexr-overrides.css sets as the kit's
 * --slc-accent-fill: what an accent fill that carries a white label is
 * painted with. White on it reads 5.41:1, where white on the #5b6cff accent
 * reads 4.17.
 */
export const ACCENT_FILL: PerTheme = { light: spexr.fill.light, dark: spexr.fill.dark };

/**
 * The kit's numbers behind --slc-accent-text, which a stylesheet can compute
 * and the colour registry cannot (it wants a plain colour): the light theme
 * caps the accent's oklch lightness at --sl-accent-text-lmax (themes/light.css)
 * and the dark theme does not; --slc-shade-step (components.css) is the kit's
 * one step of lightness. A test pins both to the installed kit.
 */
export const KIT_ACCENT_TEXT_LMAX: Record<ThemeKind, number> = { light: 0.46, dark: 1 };
export const KIT_SHADE_STEP = 0.075;

/**
 * `color-mix(in srgb, <hex> <keep>, black)` as a hex, for the colour registry,
 * which wants a plain colour: the fill's hover keeps 89% (white on it: 6.47:1).
 */
export function mixBlack(hex: string, keep: number): string {
  return `#${[1, 3, 5]
    .map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * keep).toString(16).padStart(2, "0"))
    .join("")}`;
}

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** `#rrggbb` -> OKLCH [L, C, h°]. */
function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}

/** OKLCH -> `#rrggbb`, each channel clipped to sRGB as Chrome paints a relative colour. */
function fromOklch([L, C, h]: [number, number, number]): string {
  const A = C * Math.cos((h * Math.PI) / 180);
  const B = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return `#${[
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
    .map((c) => Math.round(gamma(Math.min(1, Math.max(0, c))) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * The accent as text, as a hex: the kit's --slc-accent-text for the theme,
 * `oklch(from <accent> min(l, <cap>) c h)`. On light it is #393ccd.
 */
export function accentText(theme: ThemeKind): string {
  const [L, C, h] = toOklch(ACCENT[theme]);
  return fromOklch([Math.min(L, KIT_ACCENT_TEXT_LMAX[theme]), C, h]);
}

/**
 * A hovered link: the accent as text one kit shade step further from its
 * ground (deeper on light, lighter on dark), so the change is a step of
 * lightness, not hue, and the contrast only rises.
 */
export function accentTextActive(theme: ThemeKind): string {
  const [L, C, h] = toOklch(ACCENT[theme]);
  const text = Math.min(L, KIT_ACCENT_TEXT_LMAX[theme]);
  return fromOklch([text + (theme === "light" ? -KIT_SHADE_STEP : KIT_SHADE_STEP), C, h]);
}
