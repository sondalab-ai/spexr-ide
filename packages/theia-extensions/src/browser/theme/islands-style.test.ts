import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const resolve = createRequire(import.meta.url).resolve;
const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
const NOT_HC = ':root:not([data-sl-theme="high-contrast"])';

/** The declarations of the rule whose selector list starts with `selector` (on a line of its own). */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector}`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
}

/** The z-index a stylesheet gives `selector` (the first rule whose selector list is exactly it). */
function zIndex(file: string, selector: string): number {
  const text = readFileSync(resolve(file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(",").some((s) => s.trim() === selector)) {
      const z = /z-index:\s*(\d+)/.exec(m[2]!);
      if (z) return Number(z[1]);
    }
  }
  throw new Error(`no z-index for ${selector} in ${file}`);
}

const z = (block: string): number => Number(/z-index:\s*(\d+)/.exec(block)![1]);

// The kit's workbench layer is where the lit pane comes from: after the
// components it reads, before the effects that read it (README, 0.33).
describe("the kit's workbench.css", () => {
  it("is imported after components.css and before glass.css", () => {
    const imports = [...css.matchAll(/^@import "([^"]+)";/gm)].map((m) => m[1]);
    const at = (name: string): number => imports.indexOf(`@spexr/ui-kit/${name}`);
    expect(at("workbench.css")).toBe(at("components.css") + 1);
    expect(at("workbench.css")).toBeLessThan(at("glass.css"));
  });
});

// Lumen: the shell's areas are islands on the canvas with real gaps.
describe("the frame", () => {
  it("is the canvas, with the gap above and below the islands as layout", () => {
    expect(rule("#theia-app-shell.spexr-islands {")).toMatch(/background:\s*var\(--slc-canvas\)/);
    const split = rule("#theia-app-shell.spexr-islands > #theia-left-right-split-panel");
    expect(split).toMatch(/padding-block:\s*var\(--spexr-island-gap\)/);
    // Theia reads a side panel's size from its handle's inline offset.
    expect(split).not.toMatch(/padding(-inline|-left|-right)?:/);
  });

  it("drops the rules the islands replace", () => {
    expect(rule("#theia-app-shell.spexr-islands :is(#theia-left-content-panel, #theia-right-content-panel) > .lm-Panel")).toMatch(/border:\s*0/);
    expect(rule("#theia-bottom-content-panel.spexr-island.sl-pane,")).toMatch(/border:\s*0/);
    expect(rule("#theia-app-shell.spexr-islands > #theia-statusBar")).toMatch(/border-top-color:\s*transparent/);
  });
});

describe("an island's fill", () => {
  it("re-binds Theia's surfaces to the kit's surface rung, and to the raised rung while lit", () => {
    const fill = rule(`${NOT_HC} .spexr-island {`);
    expect(fill).toMatch(/--spexr-island-fill:\s*var\(--slc-surface\)/);
    for (const name of [
      "editor-background",
      "editorGutter-background",
      "breadcrumb-background",
      "editorGroupHeader-tabsBackground",
      "panel-background",
      "panelSectionHeader-background",
      "sideBar-background",
      "sideBarSectionHeader-background",
    ]) {
      expect(fill, name).toMatch(new RegExp(`--theia-${name}:\\s*var\\(--spexr-island-fill\\);`));
    }
    expect(rule(`${NOT_HC} .spexr-island[data-lit]`)).toMatch(/--spexr-island-fill:\s*var\(--slc-raised\)/);
  });

  it("reaches an editor's Monaco body, not every Monaco input", () => {
    const monaco = rule(`${NOT_HC} .spexr-island .theia-editor .monaco-editor`);
    expect(monaco).toMatch(/--vscode-editor-background:\s*var\(--spexr-island-fill\)/);
    expect(monaco).toMatch(/--vscode-editorGutter-background:\s*var\(--spexr-island-fill\)/);
  });
});

// Lumino's contain: strict on every layout item clips an island's outward
// ring and glow at its parent's edges, so the recipe is drawn inward.
describe("an island's ring", () => {
  it("is drawn inward over the content and takes no pointer", () => {
    const ring = rule(".spexr-island::after");
    expect(ring).toMatch(/inset:\s*0/);
    expect(ring).toMatch(/pointer-events:\s*none/);
    expect(ring).toMatch(/border-radius:\s*inherit/);
    // The ring on the outermost pixel, the lit line flush under it: no gap.
    expect(ring).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--slc-border-subtle\), inset 0 2px 0 var\(--slc-lit\);/);
    expect(rule(".spexr-island.sl-pane,")).toMatch(/box-shadow:\s*none/);
  });

  it("owns its outermost pixel: the content starts inside it, flush", () => {
    expect(rule(".spexr-island.sl-pane.lm-Widget")).toMatch(/padding:\s*1px;/);
  });

  it("leaves nothing of a collapsed side beside its activity bar", () => {
    const side = ":is(#theia-left-content-panel, #theia-right-content-panel).theia-mod-collapsed > .spexr-island";
    expect(rule(`${side}.sl-pane.lm-Widget`)).toMatch(/padding:\s*0;/);
    expect(rule(`${side}::after`)).toMatch(/display:\s*none/);
  });

  it("is the theme's line in high contrast, with no lit line or glow", () => {
    expect(rule(':root[data-sl-theme="high-contrast"] .spexr-island::after')).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--slc-border\);/);
    expect(rule(':root[data-sl-theme="high-contrast"] .spexr-island[data-lit]::after')).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--slc-border\);/);
  });

  it("carries the lit pane's glow inward, at --slc-glow's strength", () => {
    expect(rule(".spexr-island[data-lit]::after")).toMatch(
      /inset 0 0 24px -6px color-mix\(in srgb, var\(--slc-seam\) calc\(var\(--slc-glow\) \* 40%\), transparent\)/,
    );
  });
});

// The kit's seam is z-index 1, first in tree order: a dock panel's tab bar
// (Lumino, z-index 1) painted over it.
describe("the stacking inside an island", () => {
  const ring = z(rule(".spexr-island::after"));
  const seam = z(rule(".spexr-island.sl-pane[data-lit]::before"));

  it("puts the ring over Lumino's tab bars and handles", () => {
    const lumino = Math.max(
      zIndex("@lumino/widgets/style/dockpanel.css", ".lm-DockPanel-tabBar"),
      zIndex("@lumino/widgets/style/dockpanel.css", ".lm-DockPanel-handle"),
      zIndex("@theia/core/src/browser/style/dockpanel.css", '.lm-DockPanel-handle[data-orientation="vertical"]'),
    );
    expect(ring).toBeGreaterThan(lumino);
  });

  it("puts the seam over the ring and both under Theia's drop overlay", () => {
    const overlay = zIndex("@theia/core/src/browser/style/dockpanel.css", ".lm-DockPanel-overlay");
    expect(seam).toBeGreaterThan(ring);
    expect(seam).toBeLessThan(overlay);
  });
});

describe("a maximised island", () => {
  it("stays inset by the gap on the frame", () => {
    const max = rule(".spexr-island.theia-maximized");
    expect(max).toMatch(/top:\s*var\(--spexr-island-gap\) !important/);
    expect(max).toMatch(/width:\s*calc\(100% - 2 \* var\(--spexr-island-gap\)\) !important/);
  });
});
