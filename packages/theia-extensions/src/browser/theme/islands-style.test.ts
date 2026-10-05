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

// Lumen: the shell's areas are islands on the canvas with real gaps between
// them, touching the title bar and the status bar (S5c).
describe("the frame", () => {
  it("is the canvas, the islands touching both bars", () => {
    expect(rule("#theia-app-shell.spexr-islands {")).toMatch(/background:\s*var\(--slc-canvas\)/);
    // No padding on the split: Theia reads a side's size from its handle's
    // inline offset and the bottom panel's from the split's height.
    expect(css).not.toMatch(/#theia-left-right-split-panel\s*\{[^}]*padding/);
    expect(css).not.toMatch(/padding-block:\s*var\(--spexr-island-gap\)/);
  });

  it("paints a hovered sash as a 2px line centred in the gap, not the whole gap", () => {
    const across = rule("#theia-app-shell.spexr-islands > #theia-left-right-split-panel > .lm-SplitPanel-handle::after");
    expect(across).toMatch(/width:\s*2px;/);
    expect(across).toMatch(/min-width:\s*0;/);
    const down = rule("#theia-app-shell.spexr-islands #theia-bottom-split-panel > .lm-SplitPanel-handle::after");
    expect(down).toMatch(/height:\s*2px;/);
    expect(down).toMatch(/min-height:\s*0;/);
  });

  it("drops the rules the islands replace", () => {
    expect(rule("#theia-app-shell.spexr-islands :is(#theia-left-content-panel, #theia-right-content-panel) > .lm-Panel")).toMatch(/border:\s*0/);
    expect(rule("#theia-bottom-content-panel.spexr-island.sl-pane,")).toMatch(/border:\s*0/);
    // No rule above the status bar, and no transparent pixel either: the bar's 28px are its own.
    expect(rule("#theia-app-shell.spexr-islands > #theia-statusBar")).toMatch(/border-top:\s*0;/);
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

  it("reaches the Monaco body of an editor and of the Output view, not every Monaco input", () => {
    const monaco = rule(`${NOT_HC} .spexr-island :is(.theia-editor, .theia-output) .monaco-editor`);
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
    expect(rule(".spexr-island.sl-pane.lm-Widget")).toMatch(/padding:\s*var\(--spexr-island-ring\);/);
    expect(rule(":root {\n  --spexr-island-ring")).toMatch(/--spexr-island-ring:\s*1px;/);
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

// The bottom island's tabs are tile tabs (S4), as the editor's are. One lit
// seam: the current tab's seam is the accent only on the active tab bar of
// the lit bottom island, the muted ink otherwise.
describe("the bottom island's tabs", () => {
  // The tile is the editor's rule, shared through :is(); the seam and the
  // label are the bottom island's own.
  const TAB = `${NOT_HC} :is(#theia-main-content-panel, #theia-bottom-content-panel) .lm-TabBar .lm-TabBar-tab`;

  it("key the accent seam to the lit bottom island's active tab bar", () => {
    expect(rule(`${NOT_HC} #theia-bottom-content-panel .lm-TabBar {`)).toMatch(/--spexr-seam-ink:\s*var\(--slc-text-muted\)/);
    expect(rule(`${NOT_HC} #theia-bottom-content-panel.spexr-island[data-lit] .lm-TabBar.theia-tabBar-active`)).toMatch(
      /--spexr-seam-ink:\s*var\(--slc-seam\)/,
    );
    const accent = [...css.matchAll(/\n([^{}\n]*)\{\s*--spexr-seam-ink:\s*var\(--slc-seam\);/g)].map((m) => m[1]!.trim());
    for (const s of accent.filter((selector) => selector.includes("#theia-bottom-content-panel"))) {
      expect(s).toContain("#theia-bottom-content-panel.spexr-island[data-lit]");
    }
  });

  it("are 28px tiles, the current one a flat tile with the seam that replaces Theia's accent line", () => {
    const tab = rule(`${TAB} {`);
    expect(tab).toMatch(/height:\s*28px/);
    // Lumen's panel tab: r6 at 12.5px, 8px in (the editor's is r7, 13px, 12px in).
    const own = rule(`${NOT_HC} #theia-bottom-content-panel .lm-TabBar .lm-TabBar-tab {`);
    expect(own).toMatch(/border-radius:\s*var\(--sl-radius-sm\)/);
    expect(own).toMatch(/font-size:\s*0\.78125rem/);
    expect(own).toMatch(/padding-inline:\s*8px/);
    // It follows the shared tile rule, which it outweighs only by order.
    expect(css.indexOf(`\n${NOT_HC} #theia-bottom-content-panel .lm-TabBar .lm-TabBar-tab {`)).toBeGreaterThan(css.indexOf(`\n${TAB} {`));
    expect(tab).toMatch(/color:\s*var\(--slc-text-muted\)/);
    const current = rule(`${TAB}.lm-mod-current,`);
    expect(current).toMatch(/background-color:\s*var\(--slc-tile\)/);
    expect(current).toMatch(/linear-gradient\(var\(--spexr-seam-ink\), var\(--spexr-seam-ink\)\)/);
    expect(current).toMatch(/box-shadow:\s*var\(--slc-depth-flat\)/);
    expect(css).not.toMatch(/--theia-panelTitle-activeBorder/);
  });

  it("hand the label the tab's ink, over Theia's own label colours", () => {
    expect(rule(`${NOT_HC} #theia-bottom-content-panel .lm-TabBar .lm-TabBar-tab .theia-tab-icon-label.theia-tab-icon-label`)).toMatch(/color:\s*inherit/);
  });
});

// One lit seam: Theia keeps .theia-tabBar-active on one tab bar per dock
// panel whatever holds the focus, so with the Explorer lit the editor's current
// tab was a second accent seam on screen.
describe("the editor's current tab", () => {
  it("takes the accent seam only in the active group of the lit main island", () => {
    const accent = [...css.matchAll(/\n([^{}\n]*)\{\s*--spexr-seam-ink:\s*var\(--slc-seam\);/g)].map((m) => m[1]!.trim());
    const tabStrips = accent.filter((selector) => selector.includes("#theia-main-content-panel"));
    expect(tabStrips).toEqual([`${NOT_HC} #theia-main-content-panel.spexr-island[data-lit] .lm-TabBar.theia-tabBar-active`]);
    expect(rule(`${NOT_HC} #theia-main-content-panel .lm-TabBar {`)).toMatch(/--spexr-seam-ink:\s*var\(--slc-text-muted\)/);
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

// The kit's .sl-activitybar on Theia's side tab bars.
describe("the activity bars", () => {
  it("draw borderless glyphs in the muted ink, a 36px tile at r9 with no edge at rest", () => {
    const tab = rule(`${NOT_HC} .lm-TabBar.theia-app-sides .lm-TabBar-tab {`);
    expect(tab).toMatch(/width:\s*2\.25rem/);
    expect(tab).toMatch(/border-radius:\s*9px/);
    expect(tab).toMatch(/border:\s*0/);
    expect(tab).toMatch(/color:\s*var\(--slc-text-muted\)/);
    expect(tab).toMatch(/background-color:\s*transparent/);
    expect(rule(`${NOT_HC} .lm-TabBar.theia-app-sides .lm-TabBar-tabIcon {`)).toMatch(/height:\s*2\.25rem/);
  });

  it("raise the current view as a flat tile with the seam and its glyph in the accent", () => {
    const current = rule(`${NOT_HC} .lm-TabBar.theia-app-sides .lm-TabBar-tab.lm-mod-current {`);
    expect(current).toMatch(/background-color:\s*var\(--slc-tile\)/);
    expect(current).toMatch(/background-image:\s*linear-gradient\(var\(--spexr-seam-ink\), var\(--spexr-seam-ink\)\)/);
    // Half the tile's height: the padding box is 2px short of it each way (Theia's drag-over border).
    expect(current).toMatch(/background-size:\s*2px calc\(50% \+ var\(--theia-dragover-tab-border-width\)\)/);
    expect(current).toMatch(/box-shadow:\s*var\(--slc-depth-flat\)/);
    expect(rule(`${NOT_HC} .lm-TabBar.theia-app-sides .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabIcon`)).toMatch(/color:\s*var\(--slc-accent-text\)/);
  });

  it("mute the seam unless the bar holds the focus", () => {
    expect(rule(`${NOT_HC} .lm-TabBar.theia-app-sides {`)).toMatch(/--spexr-seam-ink:\s*var\(--slc-text-muted\)/);
    expect(rule(`${NOT_HC} .lm-TabBar.theia-app-sides:focus-within`)).toMatch(/--spexr-seam-ink:\s*var\(--slc-seam\)/);
  });

  it("draw the kit's count badge 4px into the tile's corner, which clips: mono 9px, a 16px pill ringed in the canvas", () => {
    const badge = rule(`${NOT_HC} .lm-TabBar.theia-app-sides .theia-badge-decorator-sidebar`);
    // 4px from the tile's top, past Theia's 2px drag-over border (workbench-style.test.ts).
    expect(badge).toMatch(/top:\s*calc\(4px - var\(--theia-dragover-tab-border-width\)\)/);
    expect(badge).toMatch(/right:\s*4px/);
    expect(badge).toMatch(/bottom:\s*auto/);
    expect(badge).toMatch(/min-width:\s*20px/);
    expect(badge).toMatch(/height:\s*1rem/);
    expect(badge).toMatch(/font:\s*600 9px\/1rem var\(--sl-font-mono\)/);
    expect(badge).toMatch(/border-radius:\s*8px/);
    expect(badge).toMatch(/box-shadow:\s*0 0 0 2px var\(--slc-canvas\)/);
    // The fill and its label stay Theia's badge variables, which the theme layer sets to the kit's fill.
    expect(badge).not.toMatch(/background|(^|[^-])color:/);
  });
});

// Theia's tree toward the kit's .sl-tree; its selected row is S2's tile.
describe("the tree's twisty", () => {
  it("is the muted ink and turns on the kit's motion tokens, never while busy", () => {
    expect(rule(`${NOT_HC} .theia-Tree .theia-ExpansionToggle {`)).toMatch(/color:\s*var\(--slc-text-muted\)/);
    expect(rule(`${NOT_HC} .theia-Tree .theia-ExpansionToggle:not(.theia-mod-busy)`)).toMatch(
      /transition:\s*transform var\(--sl-motion-fast\) var\(--sl-motion-ease\)/,
    );
  });
});
