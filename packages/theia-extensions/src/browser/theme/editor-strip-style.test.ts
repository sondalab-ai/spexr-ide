import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { EDITOR_STRIP_SHAPE, WORKBENCH } from "../shell/workbench-geometry.js";
import { contrastRatio } from "./contrast-util.js";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const css = read("../style/spexr.css");
const desktop = JSON.parse(read("../../../../../apps/desktop/package.json")) as { theia: { frontend: { config: { preferences: Record<string, unknown> } } } };
const preferences = desktop.theia.frontend.config.preferences;

/** The declarations of the first rule whose selector contains `selector`. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
}

function px(block: string, name: string): number {
  const m = new RegExp(`(?:^|[\\s;{])${name}:\\s*([\\d.]+)px`).exec(block);
  expect(m, `${name} in ${block.slice(0, 120)}`).not.toBeNull();
  return Number(m![1]);
}

const MAIN = ":root:not([data-sl-theme=\"high-contrast\"]) #theia-main-content-panel .lm-TabBar .lm-TabBar-tab.lm-mod-closable:not(.theia-mod-pinned)";

describe("the editor strip's defaults (S6c, E3, E8)", () => {
  it("leaves problem marks off tabs, and the overview ruler's border off (its lanes go through the editor provider, spexr-editor-gutter.test.ts)", () => {
    expect(preferences["problems.decorations.tabbar.enabled"]).toBe(false);
    // Git's letters reach a tab as tail decorations, which this preference gates (tab-bars.ts renderTailDecorations).
    expect(preferences["workbench.editor.decorations.badges"]).toBe(false);
    expect(preferences["editor.overviewRulerLanes"]).toBeUndefined();
    expect(preferences["editor.overviewRulerBorder"]).toBe(false);
  });
});

describe("the editor strip in spexr.css", () => {
  it("is the table's 16px close slot, which holds the dirty dot and the hover cross", () => {
    const slot = rule(`${MAIN} > .lm-TabBar-tabCloseIcon`);
    expect(px(slot, "width")).toBe(WORKBENCH.tabCloseSlot);
    expect(px(slot, "height")).toBe(WORKBENCH.tabCloseSlot);
    const dot = rule(`${MAIN} > .lm-TabBar-tabCloseIcon::before`);
    expect(px(dot, "width")).toBe(EDITOR_STRIP_SHAPE.tabDot);
    expect(px(dot, "height")).toBe(EDITOR_STRIP_SHAPE.tabDot);
    expect(dot).toMatch(/border-radius:\s*50%/);
    expect(dot).toMatch(/content:\s*""/);
  });

  it("paints a dirty tab's dot in the accent on the current tab and the muted ink elsewhere", () => {
    expect(rule(`${MAIN}.theia-mod-dirty`)).toContain("--spexr-tab-dot: var(--slc-text-muted)");
    expect(rule(`${MAIN}.theia-mod-dirty.lm-mod-current`)).toContain("--spexr-tab-dot: var(--slc-accent)");
    expect(rule(`${MAIN}.theia-mod-dirty > .lm-TabBar-tabCloseIcon::before`)).toContain("background: var(--spexr-tab-dot)");
  });

  it("shows the cross only on hover or focus, never at rest", () => {
    const cross = rule(`${MAIN}:is(:hover, :focus-within) > .lm-TabBar-tabCloseIcon::before`);
    expect(cross).toContain('content: "\\ea76"');
    expect(rule(`${MAIN} > .lm-TabBar-tabCloseIcon::before`)).toMatch(/content:\s*""/);
  });

  it("leaves a pinned tab's pin glyph alone: every slot rule excludes it, and the glyph is muted", () => {
    const strip = css.slice(css.indexOf("/* THE EDITOR STRIP"), css.indexOf("#theia-main-content-panel .theia-tabBar-breadcrumb-row {\n  background-color")).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of strip.matchAll(/([^{}]*tabCloseIcon[^{}]*)\{/g)) {
      if (m[1]!.includes("theia-mod-pinned > .lm-TabBar-tabCloseIcon")) continue;
      expect(m[1], m[1]!.trim()).toContain(":not(.theia-mod-pinned)");
    }
    expect(rule(":root:not([data-sl-theme=\"high-contrast\"]) #theia-main-content-panel .lm-TabBar .lm-TabBar-tab.theia-mod-pinned > .lm-TabBar-tabCloseIcon")).toContain("color: var(--slc-text-muted)");
  });

  it("is the table's 12px tab padding", () => {
    expect(px(rule(`${":root:not([data-sl-theme=\"high-contrast\"]) :is(#theia-main-content-panel, #theia-bottom-content-panel) .lm-TabBar .lm-TabBar-tab"}`), "padding-inline")).toBe(WORKBENCH.tabPaddingInline);
  });

  it("is the table's breadcrumb meta: the mono at 11px, muted, 16px from the row's end", () => {
    const meta = rule("#theia-main-content-panel .spexr-breadcrumbs-meta");
    expect(px(meta, "font-size")).toBe(EDITOR_STRIP_SHAPE.breadcrumbsMetaSize);
    expect(px(meta, "padding-inline-end")).toBe(WORKBENCH.breadcrumbsInset);
    expect(meta).toContain("color: var(--slc-text-muted)");
    expect(meta).toContain("font-family: var(--sl-font-mono)");
    expect(px(rule("#theia-main-content-panel .theia-breadcrumbs"), "padding-inline")).toBe(WORKBENCH.breadcrumbsInset);
  });

  it("is the table's 24px split button", () => {
    const split = rule("#theia-main-content-panel .theia-tabBar-tab-row .lm-TabBar-toolbar .item:has(> .codicon-split-horizontal)");
    expect(px(split, "width")).toBe(WORKBENCH.tabSplitButton);
    expect(px(split, "height")).toBe(WORKBENCH.tabSplitButton);
  });

  it("paints the breadcrumb ground on the row, and the crumb list transparent, so the meta shares it", () => {
    expect(rule("#theia-main-content-panel .theia-tabBar-breadcrumb-row")).toContain("background-color: var(--theia-breadcrumb-background)");
    expect(rule("#theia-main-content-panel .theia-tabBar-breadcrumb-row .theia-breadcrumbs")).toContain("background-color: transparent");
  });

  it("draws no icon slot before a breadcrumb", () => {
    expect(rule("#theia-main-content-panel .theia-breadcrumbs .theia-breadcrumb-item::before")).toContain("display: none");
  });
});

type Theme = "dark" | "light";
const neutrals = kitNeutrals.products.spexr as unknown as Record<Theme, Record<string, string>> & { accent: Record<Theme, string> };

/** The kit neutral a role var names, as neutrals.json keys it (the roles the strip's rules use). */
function neutral(theme: Theme, role: string): string {
  const key = {
    "slc-text": "text-primary",
    "slc-text-secondary": "text-secondary",
    "slc-text-muted": "text-muted",
    "slc-surface": "bg-surface",
    "slc-raised": "bg-surface-raised",
    "slc-tile": "bg-tile",
  }[role];
  expect(key, `no neutral for --${role}`).toBeDefined();
  return neutrals[theme][key!]!;
}

/** The role a rule's `property:` names as `var(--role)`, read off the CSS the strip ships. */
function roleOf(selector: string, property: string): string {
  const m = new RegExp(`(?:^|[\\s;{])${property}:\\s*var\\(--([a-z-]+)\\)`).exec(rule(selector));
  expect(m, `${property} in ${selector}`).not.toBeNull();
  return m![1]!;
}

/** A colour mixed `pct`% of `top` over `ground`, as `color-mix(in srgb, top pct%, transparent)` over it. */
function wash(top: string, ground: string, pct: number): string {
  const c = (hex: string, i: number): number => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(c(ground, i) + (c(top, i) - c(ground, i)) * (pct / 100)).toString(16).padStart(2, "0")).join("")}`;
}

// The owner's rules: text at least 4.5:1, a state indicator or boundary at least 3:1. Each ink is the role the CSS above names.
describe.each(["dark", "light"] as const)("the editor strip's inks on %s", (theme) => {
  const n = (role: string): string => neutral(theme, role);
  // The unfocused tabs and the crumbs sit on the island's surface or raised fill (the lit tint is the glow at 7%, which does not move the ratio past the margin below), the current tab is a tile.
  const PLAIN = ["slc-surface", "slc-raised"] as const;
  const TILE = ["slc-surface", "slc-raised", "slc-tile"] as const;

  it("reads the crumbs, the meta and a resting tab's label at 4.5:1 on the island's grounds", () => {
    const crumb = roleOf("#theia-main-content-panel .theia-breadcrumbs .theia-breadcrumb-item", "color");
    const meta = roleOf("#theia-main-content-panel .spexr-breadcrumbs-meta", "color");
    const tab = roleOf(":root:not([data-sl-theme=\"high-contrast\"]) :is(#theia-main-content-panel, #theia-bottom-content-panel) .lm-TabBar .lm-TabBar-tab", "color");
    for (const role of [crumb, meta, tab]) for (const ground of PLAIN) expect(contrastRatio(n(role), n(ground)), `--${role} on ${ground}`).toBeGreaterThanOrEqual(4.5);
  });

  it("reads the current crumb and the current tab's label at 4.5:1", () => {
    const current = roleOf("#theia-main-content-panel .theia-breadcrumbs .theia-breadcrumb-item:last-of-type", "color");
    for (const ground of TILE) expect(contrastRatio(n(current), n(ground)), `--${current} on ${ground}`).toBeGreaterThanOrEqual(4.5);
  });

  it("reads a hovered tab's label and a hovered crumb's at 4.5:1 on the hover wash", () => {
    const hover = roleOf(":root:not([data-sl-theme=\"high-contrast\"]) :is(#theia-main-content-panel, #theia-bottom-content-panel) .lm-TabBar .lm-TabBar-tab:hover", "color");
    const crumbHover = roleOf("#theia-main-content-panel .theia-breadcrumbs .theia-breadcrumb-item:hover", "color");
    for (const ground of PLAIN) for (const role of [hover, crumbHover]) expect(contrastRatio(n(role), wash(n("slc-text"), n(ground), 5)), `--${role} on the wash over ${ground}`).toBeGreaterThanOrEqual(4.5);
  });

  it("holds the hover cross at 3:1, on the tab's ground under the cross's own 8% wash", () => {
    const cross = roleOf(`${MAIN}:is(:hover, :focus-within) > .lm-TabBar-tabCloseIcon::before`, "color");
    for (const ground of TILE) expect(contrastRatio(n(cross), wash(n("slc-text"), wash(n("slc-text"), n(ground), 5), 8)), `--${cross} on ${ground}`).toBeGreaterThanOrEqual(3);
  });

  it("holds the dirty dot, a state indicator, at 3:1: the muted role on every tab ground, the accent on the current tile", () => {
    const muted = /--spexr-tab-dot:\s*var\(--([a-z-]+)\)/.exec(rule(`${MAIN}.theia-mod-dirty`))![1]!;
    const accent = /--spexr-tab-dot:\s*var\(--([a-z-]+)\)/.exec(rule(`${MAIN}.theia-mod-dirty.lm-mod-current`))![1]!;
    expect(accent).toBe("slc-accent");
    for (const ground of TILE) expect(contrastRatio(n(muted), n(ground)), `--${muted} on ${ground}`).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(neutrals.accent[theme], n("slc-tile")), "accent on tile").toBeGreaterThanOrEqual(3);
  });

  it("holds the current tab's seam at 3:1 on the tile: the ink the strip sets, muted in a group without the light and the seam role in the lit one", () => {
    const seam = (selector: string): string => /--spexr-seam-ink:\s*var\(--([a-z-]+)\)/.exec(rule(selector))![1]!;
    const resting = seam(':root:not([data-sl-theme="high-contrast"]) #theia-main-content-panel .lm-TabBar');
    const lit = seam(':root:not([data-sl-theme="high-contrast"]) #theia-main-content-panel.spexr-island[data-lit] .lm-TabBar.theia-tabBar-active');
    expect(resting).toBe("slc-text-muted");
    expect(lit).toBe("slc-seam");
    // --slc-seam is the accent (the kit's seam role).
    const ink = (role: string): string => (role === "slc-seam" ? neutrals.accent[theme] : n(role));
    for (const role of [resting, lit]) expect(contrastRatio(ink(role), n("slc-tile")), `--${role} on the tile`).toBeGreaterThanOrEqual(3);
  });
});

describe("the Agents tab's place (S6c, E1)", () => {
  it("is attached behind the editors at a restore, by an opt-out the registry reads, and pinned last", () => {
    expect(read("../darkfactory/darkfactory-view-contribution.ts")).toContain("readonly attachBehind = true;");
    expect(read("../darkfactory/darkfactory-view-contribution.ts")).not.toContain("override async openView");
    expect(read("../shell/spexr-shell-layout-contribution.ts")).toContain("view.openView(restoreOptions(view))");
    expect(read("../shell/spexr-shell-layout-contribution.ts")).toContain("TRAILING_PINNED_IDS = [DARKFACTORY_VIEW_ID]");
  });
});
