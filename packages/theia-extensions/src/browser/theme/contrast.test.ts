import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import kitAccents from "@sondalab/ui-kit/agent/accent-registry.json";
import { ACCENT_FILL, KIT_ACCENT_TEXT_LMAX, KIT_SHADE_STEP, accentText as registryAccentText, accentTextActive, mixBlack } from "./spexr-accent.js";

type Rgb = [number, number, number];

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG 2 contrast ratio of two sRGB colours (0-1 channels). */
function contrast(a: Rgb, b: Rgb): number {
  const lum = (c: Rgb): number => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
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
  it("carries the white label at rest and hovered", () => {
    expect(contrast(WHITE, hex(ACCENT_FILL[theme]))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WHITE, hex(mixBlack(ACCENT_FILL[theme], 0.89)))).toBeGreaterThanOrEqual(4.5);
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
