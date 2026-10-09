import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { PALETTE } from "../shell/workbench-geometry.js";
import { EDITOR_ANCHOR_VARS } from "../shell/editor-anchor.js";
import { theiaChromeCss } from "./theia-chrome-css.js";
import { contrastRatio, fromOklch, over, toOklch } from "./contrast-util.js";

const resolve = createRequire(import.meta.url).resolve;
const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
const theia = (file: string): string => readFileSync(resolve(file), "utf8");
const kitDir = dirname(resolve("@sondalab/ui-kit/effects.js"));
const kitFile = (name: string): string => readFileSync(join(kitDir, name), "utf8");
const NOT_HC = ':root:not([data-sl-theme="high-contrast"])';
const LIST = `${NOT_HC} .quick-input-list`;

/** The declarations of the rule whose selector list starts with `selector` (on a line of its own). */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector}`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
}

/** A length of a declaration as px (`38px`, or `1rem` at the kit's 16px to the rem). */
function px(body: string, name: string): number {
  const m = new RegExp(`(?:^|[\\s;{])${name}:\\s*([\\d.]+)(px|rem)`).exec(body);
  expect(m, `${name} in ${body.slice(0, 160)}`).not.toBeNull();
  return Number(m![1]) * (m![2] === "rem" ? 16 : 1);
}

/** The palette's section of spexr.css, comments stripped. */
const section = (() => {
  const start = css.indexOf("/* ══ THE COMMAND PALETTE");
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("/* Resource meter hover", start)).replace(/\/\*[\s\S]*?\*\//g, "");
})();

// Monaco writes the widget's width, left and top inline, and Theia puts the
// container at the main panel's top: the overrides are !important.
describe("where the palette floats", () => {
  it("is written inline by Monaco and by Theia, which is why the overrides are !important", () => {
    const controller = theia("@theia/monaco-editor-core/esm/vs/platform/quickinput/browser/quickInputController.js");
    expect(controller).toContain("style.width = width + 'px';");
    expect(controller).toMatch(/style\.top = `\$\{this\.viewState\?\.top/);
    expect(controller).toMatch(/style\.left = `\$\{Math\.round\(/);
    expect(theia("@theia/monaco/src/browser/monaco-quick-input-service.ts")).toContain("this.container.style.top = this.shell.mainPanel.node.getBoundingClientRect().top + 'px';");
  });

  it("is 118px from the window's top, the table's", () => {
    expect(px(rule(".quick-input-widget {"), "top")).toBe(PALETTE.top);
    expect(rule(".quick-input-widget {")).toMatch(/top:\s*118px !important/);
    expect(rule("#quick-input-container {")).toMatch(/top:\s*0 !important/);
  });

  it("is 580px wide, never wider than the window less 8px each side", () => {
    expect(rule(":root {\n  --spexr-editor-start")).toContain(`--spexr-palette-width: min(${PALETTE.width}px, calc(100vw - 16px))`);
    expect(rule(".quick-input-widget {")).toMatch(/width:\s*var\(--spexr-palette-width\) !important/);
  });

  it("is centred on the editor island the shell publishes, kept inside the window", () => {
    const left = rule(".quick-input-widget {");
    const { start, width } = EDITOR_ANCHOR_VARS;
    expect(left).toContain(`left: clamp(8px, calc(var(${start}) + (var(${width}) - var(--spexr-palette-width)) / 2), calc(100vw - var(--spexr-palette-width) - 8px)) !important`);
  });

  it("falls back to the whole window while the shell has published nothing", () => {
    const fallback = rule(":root {\n  --spexr-editor-start");
    expect(fallback).toMatch(/--spexr-editor-start:\s*0px/);
    expect(fallback).toMatch(/--spexr-editor-end:\s*0px/);
    expect(fallback).toMatch(/--spexr-editor-width:\s*100vw/);
  });
});

describe("the palette's surface", () => {
  it("is the kit's: the raised rung, no border, the cast and r14", () => {
    const widget = rule(`${NOT_HC} .quick-input-widget {`);
    expect(widget).toMatch(/background-color:\s*var\(--slc-raised\) !important/);
    expect(widget).toMatch(/border:\s*0 !important/);
    expect(widget).toMatch(/box-shadow:\s*var\(--slc-depth-cast\) !important/);
    expect(widget).toMatch(/border-radius:\s*var\(--sl-radius-lg\)/);
    expect(kitFile("tokens.css")).toMatch(new RegExp(`--sl-radius-lg:\\s*${PALETTE.radius}px`));
  });

  it("is 94% of the raised rung under a blur where the backdrop can blur, and opaque where it cannot", () => {
    expect(section).toMatch(/@supports \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\s*:root:not\(\[data-sl-theme="high-contrast"\]\) \.quick-input-widget \{\s*background-color:\s*color-mix\(in srgb, var\(--slc-raised\) 94%, transparent\) !important;/);
    expect(section).toMatch(/backdrop-filter:\s*blur\(24px\) saturate\(1\.3\)/);
    expect(section).toMatch(/@media \(prefers-reduced-transparency: reduce\) \{[^}]*background-color:\s*var\(--slc-raised\) !important;[^}]*backdrop-filter:\s*none/);
    expect(section).toMatch(/:root\[data-spexr-power-save\]:not\(\[data-sl-theme="high-contrast"\]\) \.quick-input-widget \{[^}]*background-color:\s*var\(--slc-raised\) !important;[^}]*backdrop-filter:\s*none/);
  });

  it("carries the kit's seam on its top edge: 1px, from 16px in, gone 40% before the end, glowing at 55%", () => {
    const seam = rule(`${NOT_HC} .quick-input-widget::before {`);
    expect(px(seam, "left")).toBe(16);
    expect(seam).toMatch(/right:\s*40%/);
    expect(px(seam, "height")).toBe(1);
    expect(seam).toMatch(/linear-gradient\(90deg, var\(--slc-seam\), transparent\)/);
    expect(seam).toMatch(/box-shadow:\s*0 0 12px color-mix\(in srgb, var\(--slc-seam\) calc\(55% \* min\(1, var\(--slc-glow\) \* 1000\)\), transparent\)/);
    expect(kitFile("workbench.css")).toMatch(/\.sl-palette::before \{[^}]*inset-inline: 16px 40%;[^}]*height: 1px;[^}]*calc\(55% \* min\(1, var\(--slc-glow\) \* 1000\)\)/);
  });

  it("is outlined under forced colours, which drop its ring", () => {
    expect(section).toMatch(/@media \(forced-colors: active\) \{\s*:root:not\(\[data-sl-theme="high-contrast"\]\) \.quick-input-widget \{\s*outline:\s*1px solid CanvasText/);
  });

  it("keeps Theia's own look in high contrast: the rules that reach it set only the place, the row's centring and the hidden +", () => {
    const reaching = [...section.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].filter((m) => !m[1]!.includes("data-sl-theme"));
    expect(reaching.map((m) => m[1]!.trim().replace(/\s+/g, " "))).toEqual([
      ":root",
      "#quick-input-container",
      ".quick-input-widget",
      ".quick-input-list .quick-input-list-rows",
      ".quick-input-list .monaco-keybinding > .monaco-keybinding-key-separator",
    ]);
    for (const m of reaching.slice(1, 4)) expect(m[2], m[1]).not.toMatch(/box-shadow|border-radius|background|color|backdrop-filter/);
  });
});

describe("the palette's head and field", () => {
  it("is a 52px head over the hairline, 16px in", () => {
    const head = rule(`${NOT_HC} .quick-input-widget:not(.hidden-input) .quick-input-header {`);
    expect(px(head, "min-height")).toBe(PALETTE.head);
    expect(head).toMatch(/padding:\s*0 16px/);
    expect(head).toMatch(/border-bottom:\s*1px solid var\(--slc-border-subtle\)/);
  });

  it("is the kit's field: 32px, r8, transparent, in the one control edge, its ring flush over the border", () => {
    const box = rule(`${NOT_HC} .quick-input-widget .quick-input-box .monaco-inputbox {`);
    expect(px(box, "height")).toBe(PALETTE.field);
    expect(box).toMatch(/background-color:\s*transparent !important/);
    expect(box).toMatch(/border:\s*1px solid var\(--slc-edge-control\) !important/);
    expect(box).toMatch(/border-radius:\s*var\(--sl-radius-md\)/);
    const focus = rule(`${NOT_HC} .quick-input-widget .quick-input-box .monaco-inputbox:focus-within {`);
    expect(focus).toMatch(/border-color:\s*var\(--slc-focus\) !important/);
    expect(focus).toMatch(/outline:\s*var\(--sl-focus-ring-width\) solid var\(--slc-focus\)/);
    expect(focus).toMatch(/outline-offset:\s*calc\(-1 \* var\(--sl-focus-ring-width\)\)/);
    const input = rule(`${NOT_HC} .quick-input-widget .quick-input-box .monaco-inputbox > .ibwrapper > .input {`);
    expect(px(input, "height")).toBe(PALETTE.field - 2);
    expect(px(input, "font-size")).toBe(16);
    expect(rule(`${NOT_HC} .quick-input-widget .quick-input-box .monaco-inputbox > .ibwrapper > .input:focus-visible {`)).toMatch(/outline:\s*0/);
  });
});

describe("the palette's list", () => {
  it("is 4px in at the top, 8px at the sides and below", () => {
    expect(px(rule(`${NOT_HC} .quick-input-widget:not(.hidden-input) .quick-input-list {`), "padding-top")).toBe(PALETTE.listTop);
    expect(px(rule(`${LIST} .monaco-list {`), "padding-bottom")).toBe(PALETTE.listBottom);
    expect(rule(`${LIST} .monaco-scrollable-element {`)).toMatch(new RegExp(`padding:\\s*0 ${PALETTE.listInline}px`));
  });

  it("lays a row at the table's height, r8 and 12px in, its words centred", () => {
    expect(rule(`${LIST} .monaco-list-row {`)).toMatch(/border-radius:\s*var\(--sl-radius-md\)/);
    expect(rule(`${LIST} .quick-input-list-entry {`)).toMatch(new RegExp(`padding:\\s*0 ${PALETTE.rowInline}px`));
    expect(rule(".quick-input-list .quick-input-list-rows {")).toMatch(/justify-content:\s*center/);
    // Monaco's own 22px line sits centred in the 38px row: the label, its icon and the keys keep Monaco's sizes.
    expect(theia("@theia/monaco-editor-core/esm/vs/platform/quickinput/browser/media/quickInput.css")).toMatch(/\.quick-input-list \{\s*line-height: 22px;/);
  });

  it("is a 28px heading row in the kit's mono label, with no rule above it", () => {
    const heading = rule(`${LIST} .quick-input-list-entry.quick-input-list-separator-as-item {`);
    expect(heading).toMatch(/padding:\s*8px 12px 4px/);
    expect(heading).toMatch(/font-family:\s*var\(--sl-font-mono\)/);
    expect(heading).toMatch(/font-size:\s*var\(--sl-text-micro\)/);
    expect(heading).toMatch(/letter-spacing:\s*0\.06em/);
    expect(heading).toMatch(/text-transform:\s*uppercase/);
    expect(heading).toMatch(/color:\s*var\(--slc-text-muted\)/);
    expect(rule(`${LIST} .quick-input-list-entry.quick-input-list-separator-border {`)).toMatch(/border-top:\s*0 !important/);
  });

  it("reads a row's meta in the muted ink at 12px, the secondary on the selected row, at full opacity", () => {
    const meta = rule(`${LIST} .quick-input-list-rows .quick-input-list-row .monaco-icon-label .monaco-icon-description-container .label-description {`);
    expect(meta).toMatch(/font-size:\s*var\(--sl-text-xs\) !important/);
    expect(meta).toMatch(/color:\s*var\(--slc-text-muted\) !important/);
    expect(meta).toMatch(/opacity:\s*1/);
    const selected = rule(`${LIST} .monaco-list-row.focused .quick-input-list-rows .quick-input-list-row .monaco-icon-label .monaco-icon-description-container .label-description {`);
    expect(selected).toMatch(/color:\s*var\(--slc-text-secondary\) !important/);
  });

  it("marks a match in the primary ink, heavier, underlined in the accent: never the accent alone", () => {
    const mark = rule(`${LIST} .monaco-list .monaco-list-row .monaco-highlighted-label .highlight,`);
    expect(mark).toMatch(/color:\s*inherit !important/);
    expect(mark).toMatch(/font-weight:\s*600/);
    expect(mark).toMatch(/text-decoration-line:\s*underline/);
    expect(mark).toMatch(/text-decoration-color:\s*var\(--slc-accent-text\)/);
    expect(mark).toMatch(/text-decoration-thickness:\s*1\.5px/);
    expect(mark).toMatch(/text-underline-offset:\s*3px/);
    // Monaco's and Theia's own colour on a match is !important, and the focused row's too: the rule names both.
    expect(css).toContain(`${LIST} .monaco-list .monaco-list-row.focused .monaco-highlighted-label .highlight {`);
  });

  it("keeps the selected row's seam, ring and tile: the quick input's focus colours stay the tile's", () => {
    expect(css).toMatch(/:is\(\.quick-input-list \.monaco-list-row\.focused, [^)]*\) \{\s*border-radius: var\(--sl-radius-sm\);\s*background-image: linear-gradient\(var\(--spexr-seam-ink\), var\(--spexr-seam-ink\)\);/);
    for (const theme of ["dark", "light"]) expect(theiaChromeCss(theme)).toContain("--theia-quickInputList-focusBackground: var(--slc-tile) !important");
  });
});

describe("a keycap in the palette", () => {
  it("is one cap per key, 4px from the next: Monaco's 2px a side, with the + between them out of sight", () => {
    expect(theia("@theia/monaco-editor-core/esm/vs/base/browser/ui/keybindingLabel/keybindingLabel.css")).toMatch(/\.monaco-keybinding > \.monaco-keybinding-key \{[^}]*margin: 0 2px;/);
    expect(PALETTE.keyGap).toBe(2 + 2);
    const separator = rule(".quick-input-list .monaco-keybinding > .monaco-keybinding-key-separator {");
    expect(separator).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(separator).toMatch(/position:\s*absolute/);
    expect(separator).not.toMatch(/display:\s*none/);
    const cap = rule(`${NOT_HC} :is(.quick-input-list, .action-widget .monaco-list-row) .monaco-keybinding > .monaco-keybinding-key {`);
    expect(px(cap, "min-width")).toBe(20);
    expect(px(cap, "height")).toBe(20);
  });
});

type Theme = "dark" | "light";
const THEMES: readonly Theme[] = ["dark", "light"];
const neutrals = kitNeutrals.products.spexr as unknown as Record<Theme, Record<string, string>>;

/** The kit's neutral a role var names, as neutrals.json keys it. */
function neutral(theme: Theme, role: string): string {
  const key = {
    "slc-text": "text-primary",
    "slc-text-secondary": "text-secondary",
    "slc-text-muted": "text-muted",
    "slc-canvas": "bg-canvas",
    "slc-surface": "bg-surface",
    "slc-raised": "bg-surface-raised",
    "slc-tile": "bg-tile",
  }[role];
  expect(key, `no neutral for --${role}`).toBeDefined();
  return neutrals[theme][key!]!;
}

/** --slc-accent-text: the accent as text; on light its lightness is capped (themes/light.css). */
function accentText(theme: Theme): string {
  const accent = kitNeutrals.products.spexr.accent[theme];
  if (theme === "dark") return accent;
  const cap = Number(/--sl-accent-text-lmax:\s*([\d.]+)/.exec(kitFile("themes/light.css"))![1]);
  const [L, C, h] = toOklch(accent);
  return fromOklch([Math.min(L, cap), C, h]);
}

/** --slc-edge-control (components.css): the surface's lightness stepped 5 shades away (and half a step more on paper). */
function controlEdge(theme: Theme): string {
  const k = kitFile("components.css");
  const step = Number(/--slc-shade-step:\s*([\d.]+)/.exec(k)![1]);
  const steps = Number(/--slc-edge-control-steps:\s*([\d.]+)/.exec(k)![1]);
  const [L, C, h] = toOklch(neutral(theme, "slc-surface"));
  return fromOklch([theme === "dark" ? L + step * steps : L - step * (steps + 0.5), C, h]);
}

// The owner's rules: text at least 4.5:1, a boundary or a state indicator at least 3:1.
describe.each(THEMES)("the palette's colours on %s", (theme) => {
  // The palette is the raised rung at 94% over whatever is behind it; the
  // worst case under it is the page's own primary ink (the kit's, as its
  // README states for .sl-palette). The selected row is the opaque tile.
  const ground = over(`${neutral(theme, "slc-raised")}f0`, neutral(theme, "slc-text"));
  const tile = neutral(theme, "slc-tile");

  it("takes the translucent ground at 94%, as written in the stylesheet", () => {
    expect(Math.round((0xf0 / 255) * 100)).toBe(94);
  });

  it("reads a row's label (the primary ink) at 4.5:1 on the ground and on the tile", () => {
    for (const [name, bg] of [["ground", ground], ["tile", tile]] as const) expect(contrastRatio(neutral(theme, "slc-text"), bg), name).toBeGreaterThanOrEqual(4.5);
  });

  it("reads an unselected row's meta and a group's heading (the muted ink) at 4.5:1 on the ground", () => {
    expect(contrastRatio(neutral(theme, "slc-text-muted"), ground)).toBeGreaterThanOrEqual(4.5);
  });

  it("reads the selected row's meta (the secondary ink) at 4.5:1 on the tile", () => {
    expect(contrastRatio(neutral(theme, "slc-text-secondary"), tile)).toBeGreaterThanOrEqual(4.5);
  });

  it("reads a keycap's secondary ink at 4.5:1 on both ends of its gradient, on the ground and on the tile row", () => {
    for (const end of ["slc-raised", "slc-surface"]) expect(contrastRatio(neutral(theme, "slc-text-secondary"), neutral(theme, end)), end).toBeGreaterThanOrEqual(4.5);
  });

  it("reads a match's underline and the seam (the accent text) at 4.5:1 on the ground and the tile", () => {
    for (const [name, bg] of [["ground", ground], ["tile", tile]] as const) expect(contrastRatio(accentText(theme), bg), name).toBeGreaterThanOrEqual(4.5);
  });

  it("finds the field by its edge, at 3:1 on the ground", () => {
    expect(contrastRatio(controlEdge(theme), ground)).toBeGreaterThanOrEqual(3);
  });
});
