import kitAccents from "@sondalab/ui-kit/agent/accent-registry.json";

type ThemeKind = "light" | "dark";
type PerTheme = { light: string; dark: string };

const spexr = kitAccents.products.spexr;

/** SPEXR's accent, per theme, from the kit's accent registry (`products.spexr`). */
export const ACCENT: PerTheme = { light: spexr.light, dark: spexr.dark };

/**
 * SPEXR's registered accent fill, per theme, from the kit's accent registry
 * (`products.spexr.fill`), the value the kit's themes/products.css sets as
 * --slc-accent-fill under data-sl-product="spexr" (kit 0.35): what an accent
 * fill that carries a white label is painted with. White on it reads
 * 5.41:1, where white on the #5b6cff accent read 4.17 (the kit gives that
 * accent its dark label since 0.32.1).
 */
export const ACCENT_FILL: PerTheme = { light: spexr.fill.light, dark: spexr.fill.dark };

/**
 * The kit's numbers behind --slc-accent-text and its fill steps, which a
 * stylesheet can compute and the colour registry cannot (it wants a plain
 * colour): the light theme caps the accent's oklch lightness at
 * --sl-accent-text-lmax (themes/light.css) and the dark theme does not;
 * --slc-shade-step (components.css) is the kit's one step of lightness; a
 * label turns to the dark pole above oklch L --_sl-pole-l, that pole is
 * --_sl-pole-dark, and a fill steps toward white only where pressing it
 * toward black would leave its dark label under --_sl-hold (tokens.css,
 * 0.32.1). A test pins every number to the installed kit.
 */
export const KIT_ACCENT_TEXT_LMAX: Record<ThemeKind, number> = { light: 0.46, dark: 1 };
export const KIT_SHADE_STEP = 0.075;
export const KIT_LABEL = { poleL: 0.59, poleDark: 0.16, hold: 5.4 };
export const KIT_FILL_STEP = { hover: 0.05, press: 0.1 };

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

/** OKLCH -> `#rrggbb`, each channel clamped to sRGB (the steps below stay inside it). */
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

/** WCAG relative luminance of a `#rrggbb`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * A labelled fill hovered or pressed, as a hex: the kit's step rule
 * (`--_sl-step-hover` / `--_sl-step-press`, tokens.css, 0.32.1). The fill
 * moves 0.05 (hover) or 0.10 (press) of oklch lightness toward black, unless
 * its label is the dark pole and would read under 5.4:1 pressed toward black;
 * then toward white. It moves along the line to that pole, so it stays in
 * sRGB: toward black the chroma shrinks with the lightness, toward white it
 * eases. spexr's fill (white label) hovers #424ccd and presses #3841b1, as
 * the kit's primaries do.
 */
export function fillStep(hex: string, state: keyof typeof KIT_FILL_STEP): string {
  const [L, C, h] = toOklch(hex);
  const pressedDark = (luminance(hex) * ((L - 0.1) / L) ** 3 + 0.05) / (KIT_LABEL.poleDark ** 3 + 0.05);
  return fromOklch(towardPole([L, C, h], KIT_FILL_STEP[state], L > KIT_LABEL.poleL && pressedDark < KIT_LABEL.hold));
}

/**
 * One step of oklch lightness toward black or white, along the line to that
 * pole, as the kit's step macros move it: toward black the chroma shrinks in
 * proportion to the lightness; toward white it shrinks with the share of
 * the way to white that is left, to the power 1.5. Either way the colour
 * stays in sRGB.
 */
function towardPole([L, C, h]: [number, number, number], step: number, lighter: boolean): [number, number, number] {
  return lighter
    ? [Math.min(1, L + step), C * Math.max(0, 1 - step / Math.max(1 - L, 0.001)) ** 1.5, h]
    : [Math.max(0, L - step), C * Math.max(0, 1 - step / Math.max(L, 0.001)), h];
}

/**
 * The kit's danger and warning tones, per theme (themes/light.css and
 * themes/dark.css, --sl-status-danger / --sl-status-warning). A plugin's
 * error or warning status item is painted with a literal the colour registry
 * hands it, which no stylesheet reaches, so the registry needs them as hex.
 * contrast.test.ts pins them to the installed kit.
 */
export const KIT_STATUS_FILL: Record<ThemeKind, { danger: string; warning: string }> = {
  light: { danger: "#a72b05", warning: "#795305" },
  dark: { danger: "#fe8263", warning: "#db9e2e" },
};

/**
 * The label on a fill, as a hex: the kit's one label rule (--_sl-on,
 * tokens.css), white below oklch L --_sl-pole-l and the dark pole, a grey at
 * L --_sl-pole-dark, above it. The kit's --slc-on-danger and the rest are
 * this rule on their tone. It approximates the kit's rule, which is a steep
 * ramp (clamp(pole-dark, (pole-l - l) * 1000, 1)), not a step: in the 0.001
 * of lightness just under --_sl-pole-l the kit paints a mid grey where this
 * returns white.
 */
export function labelOn(hex: string): string {
  return toOklch(hex)[0] < KIT_LABEL.poleL ? "#ffffff" : fromOklch([KIT_LABEL.poleDark, 0, 0]);
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
 * ground (deeper on light, lighter on dark), moved along the line to that
 * pole as the kit moves a fill, so it stays in sRGB and the change is a step
 * of lightness, not hue; the contrast only rises. The CSS layer writes the
 * same step as a relative colour (theia-chrome-css.ts): light #2b2da2, dark
 * #a9b3f7.
 */
export function accentTextActive(theme: ThemeKind): string {
  const [L, C, h] = toOklch(ACCENT[theme]);
  return fromOklch(towardPole([Math.min(L, KIT_ACCENT_TEXT_LMAX[theme]), C, h], KIT_SHADE_STEP, theme === "dark"));
}

/**
 * The kit's four status tones, per theme (themes/light.css and dark.css,
 * --sl-status-*). Monaco draws squiggles, ruler marks and change bars from
 * theme data, which no stylesheet reaches, and the kit's stylesheets are not
 * importable into the bundle, so the editor theme takes them as hex. Outside
 * an inversion band `--slc-<tone>-text` is the tone itself (the chrome CSS
 * falls back to it), so these are the text tones too. spexr-status-tones.test.ts
 * pins every value to the installed kit.
 */
export const KIT_STATUS_TONES: Record<ThemeKind, { success: string; warning: string; danger: string; info: string }> = {
  light: { success: "#4a6205", warning: "#795305", danger: "#a72b05", info: "#3853af" },
  dark: { success: "#98b958", warning: "#db9e2e", danger: "#fe8263", info: "#87a7fd" },
};
