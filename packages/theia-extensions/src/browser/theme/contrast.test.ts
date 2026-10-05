import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("leave the accent as text uncapped on the dark theme", () => {
    expect(KIT_ACCENT_TEXT_LMAX.dark).toBe(1);
    expect(kitFile("themes/dark.css")).not.toMatch(/--sl-accent-text-lmax/);
    expect(kitFile("components.css")).toMatch(/min\(l, var\(--sl-accent-text-lmax, 1\)\)/);
  });
});

// The outputs the kit's own CSS gives, evaluated in Chrome against ui-kit
// 0.32.1 (tokens.css's step macros on the fills; the CSS layer's link hover):
// literals, so a change in the kit's rule or in its exponents, floors or
// ramps shows up here, not only in a second copy of the formula.
describe("the derived colours, pinned to the kit's own output", () => {
  it("steps spexr's white-label fill toward black", () => {
    expect(fillStep(ACCENT_FILL.light, "hover")).toBe("#424ccd");
    expect(fillStep(ACCENT_FILL.light, "press")).toBe("#3841b1");
  });

  it("steps a dark-label fill toward white", () => {
    expect(fillStep("#8b96ff", "hover")).toBe("#9faafa");
    expect(fillStep("#8b96ff", "press")).toBe("#b3bdf6");
  });

  it("gives the accent as text and a hovered link the CSS layer's colours", () => {
    expect(registryAccentText("light")).toBe("#393ccd");
    expect(registryAccentText("dark")).toBe("#8b96ff");
    expect(accentTextActive("light")).toBe("#2b2da2");
    expect(accentTextActive("dark")).toBe("#a9b3f7");
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

// The lit pane's glow falls inward (spexr.css, THE WORKBENCH): the seam at
// --slc-glow x 40% over the lit rung, strongest along the island's edge, where
// a row's text can sit. Text there must still read at 4.5:1. Dark had 0.02 to
// spare at kit 0.33 (muted 4.52), so a stronger glow would break it unnoticed.
describe.each(["light", "dark"] as const)("the lit pane's inward glow on %s", (theme) => {
  const components = kitFile("components.css");
  // The kit's strength: 0.5 on :root (dark), 0.35 on the light theme.
  const glow = Number(
    (theme === "light" ? /:root\[data-sl-theme="light"\]\s*\{[^}]*?--slc-glow:\s*([\d.]+)/ : /--slc-glow:\s*([\d.]+)/).exec(components)![1],
  );
  const raised = hex(neutrals[theme]["bg-surface-raised"]);
  // color-mix(in srgb, seam N%, transparent) over the raised rung.
  const alpha = glow * 0.4;
  const ground = raised.map((c, i) => c * (1 - alpha) + accentText[theme][i]! * alpha) as Rgb;

  it("is drawn at 40% of the kit's glow, from the seam", () => {
    const spexr = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
    expect(spexr).toContain("inset 0 0 24px -6px color-mix(in srgb, var(--slc-seam) calc(var(--slc-glow) * 40%), transparent)");
    expect(glow).toBe(theme === "light" ? 0.35 : 0.5);
  });

  it("leaves secondary and muted text at 4.5:1 or more where it is strongest", () => {
    expect(contrast(hex(neutrals[theme]["text-secondary"]), ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(neutrals[theme]["text-muted"]), ground)).toBeGreaterThanOrEqual(4.5);
  });
});
