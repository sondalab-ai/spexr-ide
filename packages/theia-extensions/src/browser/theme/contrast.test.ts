import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import kitAccents from "@sondalab/ui-kit/agent/accent-registry.json";
import { ACCENT_FILL, KIT_ACCENT_TEXT_LMAX, KIT_FILL_STEP, KIT_LABEL, KIT_SHADE_STEP, accentText as registryAccentText, accentTextActive, fillStep } from "./spexr-accent.js";

type Rgb = [number, number, number];

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG relative luminance of an sRGB colour (0-1 channels). */
const lum = (c: Rgb): number => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);

/** WCAG 2 contrast ratio of two sRGB colours (0-1 channels). */
function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** sRGB -> OKLCH [L, C, h°]. */
function oklch(c: Rgb): [number, number, number] {
  const [r, g, b] = c.map(linear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}

/** OKLCH -> sRGB, each channel clipped to the gamut as Chrome paints it. */
function srgb([L, C, h]: [number, number, number]): Rgb {
  const A = C * Math.cos((h * Math.PI) / 180);
  const B = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lin: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => Math.min(1, Math.max(0, gamma(Math.min(1, Math.max(0, c)))))) as Rgb;
}

const kitDir = dirname(createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.js"));
const kitFile = (name: string): string => readFileSync(join(kitDir, name), "utf8");

/** The light theme's cap on the accent as text, from the installed kit. */
function textLmax(): number {
  return Number(/--sl-accent-text-lmax:\s*([\d.]+)/.exec(kitFile("themes/light.css"))![1]);
}

/** A number the kit's tokens.css declares on :root (0.32.1's label and step macros). */
const kitNumber = (re: RegExp): number => Number(re.exec(kitFile("tokens.css"))![1]);
const POLE_L = kitNumber(/--_sl-pole-l:\s*([\d.]+)/);
const POLE_DARK = kitNumber(/--_sl-pole-dark:\s*([\d.]+)/);
const HOLD = kitNumber(/--_sl-hold:\s*([\d.]+)/);
const STEP = {
  hover: kitNumber(/--_sl-step-hover:\s*clamp\(0, l \+ ([\d.]+) \*/),
  press: kitNumber(/--_sl-step-press:\s*clamp\(0, l \+ ([\d.]+) \*/),
};

/** The kit's step rule (tokens.css --_sl-step-hover / -press), written again from its CSS. */
function kitStep(fill: Rgb, step: number): Rgb {
  const [L, C, h] = oklch(fill);
  const pressedDark = (lum(fill) * ((L - 0.1) / L) ** 3 + 0.05) / (POLE_DARK ** 3 + 0.05);
  const lighter = L > POLE_L && pressedDark < HOLD ? 1 : 0;
  const C2 = C * (lighter * Math.max(0, 1 - step / Math.max(1 - L, 0.001)) ** 1.5 + (1 - lighter) * Math.max(0, 1 - step / Math.max(L, 0.001)));
  return srgb([Math.min(1, Math.max(0, L + step * (2 * lighter - 1))), C2, h]);
}

const toBytes = (c: Rgb): number[] => c.map((v) => Math.round(v * 255));
const WHITE: Rgb = [1, 1, 1];
const neutrals = kitNeutrals.products.spexr;
const accent = kitAccents.products.spexr;
/** --slc-accent-text: the accent with its lightness capped (light), the accent itself (dark). */
const accentText = {
  light: (() => {
    const [L, C, h] = oklch(hex(accent.light));
    return srgb([Math.min(L, textLmax()), C, h]);
  })(),
  dark: hex(accent.dark),
};

// The owner's rules: text at least 4.5:1, a state indicator at least 3:1.
describe.each(["light", "dark"] as const)("spexr's registered fill on %s", (theme) => {
  it("carries the white label at rest, hovered and pressed", () => {
    expect(contrast(WHITE, hex(ACCENT_FILL[theme]))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WHITE, hex(fillStep(ACCENT_FILL[theme], "hover")))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WHITE, hex(fillStep(ACCENT_FILL[theme], "press")))).toBeGreaterThanOrEqual(4.5);
  });

  it("hovers and presses by the kit's step rule, as the kit's primaries do", () => {
    for (const state of ["hover", "press"] as const) {
      expect(toBytes(hex(fillStep(ACCENT_FILL[theme], state))), state).toEqual(toBytes(kitStep(hex(ACCENT_FILL[theme]), STEP[state])));
    }
  });
});

// spexr-accent.ts carries the kit's label and step numbers as constants (the
// registry cannot run CSS); they must be the installed kit's.
describe("the kit's label and step numbers", () => {
  it("match tokens.css", () => {
    expect(KIT_LABEL).toEqual({ poleL: POLE_L, poleDark: POLE_DARK, hold: HOLD });
    expect(KIT_FILL_STEP).toEqual(STEP);
  });
});

// The colour registry cannot hold a var(), so spexr-accent.ts derives the
// accent as text as a hex with the kit's own rule and numbers.
describe("the registry's accent as text", () => {
  it("uses the installed kit's cap and shade step", () => {
    expect(KIT_ACCENT_TEXT_LMAX.light).toBe(textLmax());
    expect(KIT_SHADE_STEP).toBe(Number(/--slc-shade-step:\s*([\d.]+)/.exec(kitFile("components.css"))![1]));
  });

  it.each(["light", "dark"] as const)("is the kit's --slc-accent-text on %s", (theme) => {
    expect(hex(registryAccentText(theme)).map((c) => Math.round(c * 255))).toEqual(accentText[theme].map((c) => Math.round(c * 255)));
  });

  it.each(["light", "dark"] as const)("reads at 4.5:1 at rest and hovered on %s, and hovering changes its lightness", (theme) => {
    const rest = hex(registryAccentText(theme));
    const hovered = hex(accentTextActive(theme));
    for (const ground of ["bg-canvas", "bg-surface", "bg-surface-raised", "bg-tile"] as const) {
      expect(contrast(rest, hex(neutrals[theme][ground])), ground).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hovered, hex(neutrals[theme][ground])), ground).toBeGreaterThan(contrast(rest, hex(neutrals[theme][ground])));
    }
    expect(contrast(rest, hovered)).toBeGreaterThanOrEqual(1.2);
  });
});

describe.each(["light", "dark"] as const)("the selection tile on %s", (theme) => {
  const tile = hex(neutrals[theme]["bg-tile"]);

  it("carries the primary ink", () => {
    expect(contrast(hex(neutrals[theme]["text-primary"]), tile)).toBeGreaterThanOrEqual(4.5);
  });

  it("is found by its seam, the accent or the muted ink", () => {
    expect(contrast(accentText[theme], tile)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex(neutrals[theme]["text-muted"]), tile)).toBeGreaterThanOrEqual(3);
  });

  it("puts the accent as text at 4.5:1 on the canvas and the surface", () => {
    for (const ground of ["bg-canvas", "bg-surface", "bg-surface-raised"] as const) {
      expect(contrast(accentText[theme], hex(neutrals[theme][ground])), ground).toBeGreaterThanOrEqual(4.5);
    }
  });
});
