import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { contrastRatio, fromOklch, toOklch } from "./contrast-util.js";

const resolve = createRequire(import.meta.url).resolve;
const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
const kitDir = dirname(resolve("@sondalab/ui-kit/effects.js"));
const kitFile = (name: string): string => readFileSync(join(kitDir, name), "utf8");
const NOT_HC = ':root:not([data-sl-theme="high-contrast"])';
const MAIN = "#theia-main-content-panel.spexr-island[data-lit]";

/** The declarations of the rule whose selector list starts with `selector` (on a line of its own). */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector}`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
}

// The lit island's light (S5f): the kit's three roles, worn on Theia's DOM.
describe("the lit island's light in spexr.css", () => {
  it("washes the main island's row of tabs (not the whole bar, which holds the breadcrumbs too), and only while it is lit", () => {
    expect(rule(`${NOT_HC} ${MAIN} .lm-TabBar .theia-tabBar-tab-row {`)).toMatch(/background-image:\s*var\(--slc-lit-wash\);/);
    const bars = readFileSync(resolve("@theia/core/lib/browser/shell/tab-bars.js"), "utf8");
    expect(bars).toContain("this.topRow.classList.add('theia-tabBar-tab-row');");
    expect(bars).toContain("this.breadcrumbsContainer.classList.add('theia-tabBar-breadcrumb-row');");
    expect(bars).toContain("this.node.appendChild(this.breadcrumbsContainer);");
  });

  it("tints the breadcrumbs under it, and only while the main island is lit", () => {
    expect(rule(`${NOT_HC} ${MAIN} .theia-breadcrumbs {`)).toMatch(/background-image:\s*var\(--slc-lit-tint\);/);
  });

  it("wears the drop inward on the handle under the lit main island: the gap between it and the bottom island", () => {
    const drop = rule(`${NOT_HC} #theia-bottom-split-panel:has(> #theia-main-content-panel.spexr-island[data-lit]) > .lm-SplitPanel-handle {`);
    expect(drop).toMatch(/box-shadow:\s*inset var\(--slc-lit-drop\);/);
  });

  it("paints no light on any other island: no rule wears the roles outside the main island's strip and rows", () => {
    const wearing = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*--slc-lit-(?:wash|tint|drop)[^{}]*)\}/g)].map((m) => m[1]!.trim().replace(/\s+/g, " "));
    expect(wearing).toEqual([
      `${NOT_HC} ${MAIN} .lm-TabBar .theia-tabBar-tab-row`,
      `${NOT_HC} ${MAIN} .theia-breadcrumbs`,
      `${NOT_HC} #theia-bottom-split-panel:has(> #theia-main-content-panel.spexr-island[data-lit]) > .lm-SplitPanel-handle`,
    ]);
  });

  it("keeps one lit island: the mark is the shell's, on one area at a time", () => {
    const islands = readFileSync(fileURLToPath(new URL("../shell/islands.ts", import.meta.url)), "utf8");
    expect(islands).toMatch(/node\.toggleAttribute\(LIT_ATTR, area === lit\)/);
  });

  it("is made of the kit's roles as installed: the drop starts at the handle's top edge, falling downward", () => {
    const components = kitFile("components.css");
    expect(components).toMatch(/--slc-lit-drop: 0 18px 30px -18px color-mix\(in srgb, var\(--slc-seam\) calc\(var\(--slc-glow\) \* 40%\), transparent\)/);
    expect(components).toMatch(/--slc-lit-wash: radial-gradient\(80% 100% at var\(--_sl-lit-x\) 0%, color-mix\(in srgb, oklch\(from var\(--slc-seam\) min\(l, 0\.65\) calc\(c \* min\(1, 0\.65 \/ l\)\) h\) calc\(var\(--slc-glow\) \* 41\.6%\), transparent\), transparent 78%\)/);
    expect(components).toMatch(/--slc-lit-tint: linear-gradient\(color-mix\(in srgb, var\(--slc-seam\) calc\(var\(--slc-glow\) \* 7%\), transparent\), transparent\)/);
  });
});

type Theme = "dark" | "light";
const THEMES: readonly Theme[] = ["dark", "light"];
const neutrals = kitNeutrals.products.spexr as unknown as Record<Theme, Record<string, string>>;

/** --slc-glow for a theme: the root's 0.5, the light theme's own 0.35 (components.css). */
function glow(theme: Theme): number {
  const components = kitFile("components.css");
  const root = Number(/\n {2}--slc-glow:\s*([\d.]+);/.exec(components)![1]);
  const light = Number(/:root\[data-sl-theme="light"\] \{[^}]*--slc-glow:\s*([\d.]+);/.exec(components)![1]);
  return theme === "light" ? light : root;
}

/** --slc-seam: the accent as text; on light its lightness is capped (themes/light.css). */
function seam(theme: Theme): string {
  const accent = kitNeutrals.products.spexr.accent[theme];
  if (theme === "dark") return accent;
  const cap = Number(/--sl-accent-text-lmax:\s*([\d.]+)/.exec(kitFile("themes/light.css"))![1]);
  const [L, C, h] = toOklch(accent);
  return fromOklch([Math.min(L, cap), C, h]);
}

/** `top` painted at `alpha` over `ground`, per channel, as `#rrggbb`. */
function mix(top: string, ground: string, alpha: number): string {
  const ch = (hex: string, i: number): number => parseInt(hex.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(ch(ground, i) + (ch(top, i) - ch(ground, i)) * alpha).toString(16).padStart(2, "0")).join("")}`;
}

// The owner's rules: text at least 4.5:1. The light sits under the tab labels
// and the crumbs, at its strongest on the strip's top edge, where it peaks.
describe.each(THEMES)("the text under the lit island's light on %s", (theme) => {
  // The lit island's fill is the raised rung; the wash and the tint are over it.
  const raised = neutrals[theme]["bg-surface-raised"]!;
  const muted = neutrals[theme]["text-muted"]!;

  it("peaks at the kit's 41.6% of --slc-glow, with the seam capped at oklch L 0.65", () => {
    const [L, C, h] = toOklch(seam(theme));
    const wash = fromOklch([Math.min(L, 0.65), C * Math.min(1, 0.65 / L), h]);
    const peak = glow(theme) * 0.416;
    expect(Math.round(peak * 1000) / 10).toBe(theme === "dark" ? 20.8 : 14.6);
    expect(contrastRatio(muted, mix(wash, raised, peak)), "a muted tab label at the wash's peak").toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(neutrals[theme]["text-secondary"]!, mix(wash, raised, peak)), "a secondary label at the wash's peak").toBeGreaterThanOrEqual(4.5);
  });

  it("holds the crumbs (the muted ink) at 4.5:1 on the tint's top edge, the seam at 7% of --slc-glow", () => {
    const top = glow(theme) * 0.07;
    expect(contrastRatio(muted, mix(seam(theme), raised, top))).toBeGreaterThanOrEqual(4.5);
  });
});
