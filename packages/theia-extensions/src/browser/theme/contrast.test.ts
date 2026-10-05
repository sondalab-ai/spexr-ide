import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import kitAccents from "@sondalab/ui-kit/agent/accent-registry.json";
import { ACCENT_FILL, KIT_ACCENT_TEXT_LMAX, KIT_FILL_STEP, KIT_LABEL, KIT_SHADE_STEP, KIT_STATUS_FILL, accentText as registryAccentText, accentTextActive, fillStep, labelOn } from "./spexr-accent.js";
import { theiaChromeCss } from "./theia-chrome-css.js";
import { labelledFillColors } from "./spexr-color-contribution.js";

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
/** The kit's --_sl-on, written again from tokens.css: white below the pole's lightness, the dark pole above. */
const kitLabel = (fill: Rgb): Rgb => (oklch(fill)[0] < POLE_L ? WHITE : srgb([POLE_DARK, 0, 0]));
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

/** A fill's label (the kit's, as spexr-accent.ts labelOn derives it) reads at 4.5:1 on it at rest, hovered and pressed. */
function expectLabelled(fill: string): void {
  const label = kitLabel(hex(fill));
  expect(toBytes(hex(labelOn(fill))), `labelOn(${fill})`).toEqual(toBytes(label));
  expect(contrast(label, hex(fill)), fill).toBeGreaterThanOrEqual(4.5);
  expect(contrast(label, hex(fillStep(fill, "hover"))), `${fill} hovered`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(label, hex(fillStep(fill, "press"))), `${fill} pressed`).toBeGreaterThanOrEqual(4.5);
}

// The owner's rules: text at least 4.5:1, a state indicator at least 3:1.
describe.each(["light", "dark"] as const)("spexr's registered fill on %s", (theme) => {
  it("carries the kit's label at rest, hovered and pressed", () => {
    expectLabelled(ACCENT_FILL[theme]);
  });

  // Since kit 0.35 the fill is one registry line per theme, and the owner may
  // move the dark one to the accent itself; Theia's chrome then takes the
  // dark pole for its label, as the kit's controls do.
  it("would carry the kit's label on the accent itself, a fill the registry may name", () => {
    expectLabelled(accent[theme]);
  });

  it("hovers and presses by the kit's step rule, as the kit's primaries do", () => {
    for (const state of ["hover", "press"] as const) {
      expect(toBytes(hex(fillStep(ACCENT_FILL[theme], state))), state).toEqual(toBytes(kitStep(hex(ACCENT_FILL[theme]), STEP[state])));
    }
  });
});

// A fill the registry may name instead: the owner's pending dark fill is the
// accent itself, #8b96ff, where white reads 2.66:1. Theia's chrome and the
// colour registry are handed it, and their labels are read back and measured
// with this file's own contrast(), so a label hard-coded to white fails here.
describe("a light fill handed to Theia's chrome and the colour registry", () => {
  const fills = { light: ACCENT_FILL.light, dark: "#8b96ff" };
  const css = theiaChromeCss("dark", fills);
  const chrome = (name: string): string => new RegExp(`--theia-${name}:\\s*([^;]+?)\\s*!important;`).exec(css)![1]!;
  const rest = hex(fills.dark);
  const pressed = kitStep(rest, STEP.press);

  it("labels the button, the badges and the menu selection in the dark pole, at 4.5:1 at rest, hovered and pressed", () => {
    expect(chrome("button-background")).toBe(fills.dark);
    const hovered = hex(chrome("button-hoverBackground"));
    for (const name of ["button-foreground", "badge-foreground", "activityBarBadge-foreground", "menu-selectionForeground"]) {
      const label = chrome(name);
      expect(label, name).toBe("#0d0d0d");
      for (const [state, ground] of [["rest", rest], ["hovered", hovered], ["pressed", pressed]] as const) {
        expect(contrast(hex(label), ground), `${name} ${state}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("registers the same label for the button and badge, at 4.5:1 at rest, hovered and pressed", () => {
    const colors = labelledFillColors(fills);
    expect(colors.background.dark).toBe(fills.dark);
    expect(colors.foreground.dark).toBe("#0d0d0d");
    for (const [state, ground] of [["rest", rest], ["hovered", hex(colors.hoverBackground.dark)], ["pressed", pressed]] as const) {
      expect(contrast(hex(colors.foreground.dark), ground), state).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is hard-coded white in neither source", () => {
    for (const file of ["./theia-chrome-css.ts", "./spexr-color-contribution.ts"]) {
      expect(readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"), file).not.toMatch(/#fff(fff)?\b/i);
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

// The status dock (spexr.css): an item with a ground of its own is found by
// its fill, at least 3:1 against the canvas it sits on, and reads at 4.5:1 in
// the kit's label on it. A plugin's error and warning grounds are registry
// literals (spexr-color-contribution.ts); the prominent and offline ones are
// the CSS layer's (theia-chrome-css.ts).
describe.each(["light", "dark"] as const)("the status dock on %s", (theme) => {
  const canvas = hex(neutrals[theme]["bg-canvas"]);
  const surface = hex(neutrals[theme]["bg-surface"]);
  const muted = hex(neutrals[theme]["text-muted"]);
  const tone = (name: string): string => new RegExp(`--sl-status-${name}:\\s*(#[0-9a-f]{6})`).exec(kitFile(`themes/${theme}.css`))![1]!;

  it("registers the installed kit's danger and warning tones, with the kit's label", () => {
    expect(KIT_STATUS_FILL[theme]).toEqual({ danger: tone("danger"), warning: tone("warning") });
    for (const fill of Object.values(KIT_STATUS_FILL[theme])) {
      expect(toBytes(hex(labelOn(fill))), fill).toEqual(toBytes(kitLabel(hex(fill))));
    }
  });

  it("bounds an error, a warning and a prominent item at 3:1 on the canvas, and labels each at 4.5:1", () => {
    for (const fill of [hex(KIT_STATUS_FILL[theme].danger), hex(KIT_STATUS_FILL[theme].warning), muted]) {
      expect(contrast(fill, canvas)).toBeGreaterThanOrEqual(3);
      expect(contrast(kitLabel(fill), fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("labels the offline bar at 4.5:1 at rest, hovered and pressed", () => {
    const warning = hex(KIT_STATUS_FILL[theme].warning);
    for (const fill of [warning, kitStep(warning, STEP.hover), kitStep(warning, STEP.press)]) {
      expect(contrast(kitLabel(warning), fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("reads the data ink and the muted ink at 4.5:1 on the canvas and on a hovered item", () => {
    for (const ground of [canvas, surface]) {
      expect(contrast(hex(neutrals[theme]["text-primary"]), ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(muted, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("marks a live state with a dot at 3:1 on the canvas and on a hovered item", () => {
    for (const ground of [canvas, surface]) expect(contrast(accentText[theme], ground)).toBeGreaterThanOrEqual(3);
  });
});

// A toast (spexr.css): the words on the raised rung, the glyph in its tone on
// a 12% wash of itself over it (the kit's badge recipe), and the tick in the
// tone against the raised rung.
describe.each(["light", "dark"] as const)("a toast on %s", (theme) => {
  const raised = hex(neutrals[theme]["bg-surface-raised"]);
  const tone = (name: string): Rgb => hex(new RegExp(`--sl-status-${name}:\\s*(#[0-9a-f]{6})`).exec(kitFile(`themes/${theme}.css`))![1]!);
  const over = (ink: Rgb, alpha: number, ground: Rgb): Rgb => ground.map((c, i) => c * (1 - alpha) + ink[i]! * alpha) as Rgb;

  it("reads its words, its source and its buttons' glyphs at 4.5:1", () => {
    for (const ink of ["text-primary", "text-secondary", "text-muted"] as const) {
      expect(contrast(hex(neutrals[theme][ink]), raised), ink).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(["info", "warning", "danger"])("draws the %s glyph at 4.5:1 on its wash, and its tick at 3:1", (name) => {
    const ink = tone(name);
    expect(contrast(ink, over(ink, 0.12, raised))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, raised)).toBeGreaterThanOrEqual(3);
  });

  it("lifts the focused row in the center as a tile that carries the primary ink", () => {
    expect(contrast(hex(neutrals[theme]["text-primary"]), hex(neutrals[theme]["bg-tile"]))).toBeGreaterThanOrEqual(4.5);
  });
});
