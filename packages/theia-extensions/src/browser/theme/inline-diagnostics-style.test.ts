import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { INLINE_DIAGNOSTIC } from "../shell/workbench-geometry.js";
import { contrastRatio } from "./contrast-util.js";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const css = read("../style/spexr.css").replace(/\/\*[\s\S]*?\*\//g, "");
const kitDir = dirname(createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.js"));
const kitFile = (name: string): string => readFileSync(join(kitDir, name), "utf8");
const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim().replace(/\s+/g, " "), body: m[2]! }));
const rules = (selector: string): string => {
  const found = RULES.filter((r) => r.selector.split(/\s*,\s*/).includes(selector)).map((r) => r.body);
  expect(found.length, `${selector} not found in spexr.css`).toBeGreaterThan(0);
  return found.join("\n");
};
const px = (body: string, name: string): number => {
  const m = new RegExp(`(?:^|[\\s;])${name}:\\s*([\\d.]+)px`).exec(body);
  expect(m, `${name} in ${body.slice(0, 120)}`).not.toBeNull();
  return Number(m![1]);
};

// The numbers repeat INLINE_DIAGNOSTIC in shell/workbench-geometry.ts: CSS cannot read it.
describe("the inline diagnostic chip in spexr.css", () => {
  it("is the table's chip: 24px after the code, 8px of padding, r4, the sans at 12px", () => {
    const chip = rules(".spexr-inline-diag");
    expect(px(chip, "margin-left")).toBe(INLINE_DIAGNOSTIC.marginLeft);
    expect(chip).toMatch(new RegExp(`padding:\\s*0 ${INLINE_DIAGNOSTIC.paddingInline}px`));
    expect(px(chip, "border-radius")).toBe(INLINE_DIAGNOSTIC.radius);
    expect(px(chip, "font-size")).toBe(INLINE_DIAGNOSTIC.fontSize);
    expect(chip).toMatch(/font-family:\s*var\(--sl-font-sans\)/);
    expect(INLINE_DIAGNOSTIC.radius % 4).toBe(0);
    expect(INLINE_DIAGNOSTIC.marginLeft % 4).toBe(0);
  });

  it("is the tone's text on a 12% wash of the tone, for a warning and for an error", () => {
    expect(rules(".spexr-inline-diag--warning")).toMatch(new RegExp(`color:\\s*var\\(--slc-warning-text, var\\(--slc-warning\\)\\);\\s*background:\\s*color-mix\\(in srgb, var\\(--slc-warning\\) ${INLINE_DIAGNOSTIC.washPercent}%, transparent\\)`));
    expect(rules(".spexr-inline-diag--error")).toMatch(new RegExp(`color:\\s*var\\(--slc-danger-text, var\\(--slc-danger\\)\\);\\s*background:\\s*color-mix\\(in srgb, var\\(--slc-danger\\) ${INLINE_DIAGNOSTIC.washPercent}%, transparent\\)`));
  });

  it("writes no colour literal, and does not animate", () => {
    for (const r of RULES.filter((x) => /spexr-inline-diag/.test(x.selector))) {
      expect(r.body, r.selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch)\(|\banimation\b|\btransition\b/);
    }
  });
});

describe("the inline diagnostics' sources", () => {
  it("draws the text as injected text, never as markup, behind the preference, for showing editors, after a pause", () => {
    const src = read("../editor/inline-diagnostics-contribution.ts");
    expect(src).toMatch(/after: \{ content: d\.text, inlineClassName: inlineClass\(d\.tone\)/);
    expect(src).not.toMatch(/innerHTML|insertAdjacentHTML|dangerouslySetInnerHTML/);
    expect(src).toMatch(/SPEXR_EDITOR_INLINE_DIAGNOSTICS_PREFERENCE/);
    expect(src).toMatch(/widget\.isVisible/);
    expect(src).toMatch(/REFRESH_MS = 200/);
    expect(read("../preferences/spexr-preferences.ts")).toMatch(/\[SPEXR_EDITOR_INLINE_DIAGNOSTICS_PREFERENCE\]: \{\s*type: "boolean",\s*default: true/);
  });
});

type Theme = "dark" | "light";
const neutrals = kitNeutrals.products.spexr as unknown as Record<Theme, Record<string, string>>;
const status = (theme: Theme, name: "warning" | "danger"): string => new RegExp(`--sl-status-${name}:\\s*(#[0-9a-f]{6})`).exec(kitFile(`themes/${theme}.css`))![1]!;
const mix = (fg: string, pct: number, bg: string): string => {
  const ch = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [f, b] = [ch(fg), ch(bg)];
  return `#${f.map((c, i) => Math.round(c * (pct / 100) + b[i]! * (1 - pct / 100)).toString(16).padStart(2, "0")).join("")}`;
};

// The owner's rule: text at least 4.5:1, on the editor's own ground and on the current line's wash.
describe.each(["dark", "light"] as const)("the inline diagnostic chip on %s", (theme) => {
  const ground = neutrals[theme]["bg-surface"]!;
  for (const tone of ["warning", "danger"] as const) {
    it(`reads the ${tone} text at 4.5:1 on its 12% wash over the editor's ground`, () => {
      const ink = status(theme, tone);
      const wash = mix(ink, INLINE_DIAGNOSTIC.washPercent, ground);
      expect(contrastRatio(ink, wash)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
