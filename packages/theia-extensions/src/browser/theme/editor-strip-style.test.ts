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

const MAIN = ":root:not([data-sl-theme=\"high-contrast\"]) #theia-main-content-panel .lm-TabBar .lm-TabBar-tab";

describe("the editor strip's defaults (S6c, E3, E8)", () => {
  it("leaves problem marks off tabs, and the overview ruler off the editor", () => {
    expect(preferences["problems.decorations.tabbar.enabled"]).toBe(false);
    expect(preferences["editor.overviewRulerLanes"]).toBe(0);
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
    const cross = rule(`${MAIN}.lm-mod-closable:is(:hover, :focus-within) > .lm-TabBar-tabCloseIcon::before`);
    expect(cross).toContain('content: "\\ea76"');
    expect(rule(`${MAIN} > .lm-TabBar-tabCloseIcon::before`)).toMatch(/content:\s*""/);
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

  it("draws no icon slot before a breadcrumb", () => {
    expect(rule("#theia-main-content-panel .theia-breadcrumbs .theia-breadcrumb-item::before")).toContain("display: none");
  });
});

type Theme = "dark" | "light";
const neutrals = kitNeutrals.products.spexr as unknown as Record<Theme, Record<string, string>> & { accent: Record<Theme, string> };

// The owner's rules: text at least 4.5:1, a state indicator at least 3:1.
describe.each(["dark", "light"] as const)("the editor strip's inks on %s", (theme) => {
  const n = (key: string): string => neutrals[theme][key]!;
  // Grounds: an unfocused tab sits on the island's surface or raised fill, the current tab is a tile; the breadcrumbs lie on raised.
  const GROUNDS = ["bg-surface", "bg-surface-raised", "bg-tile"] as const;

  it("reads the breadcrumb meta and the crumbs (muted ink) at 4.5:1 on the island's grounds", () => {
    for (const ground of ["bg-surface", "bg-surface-raised"] as const) expect(contrastRatio(n("text-muted"), n(ground)), ground).toBeGreaterThanOrEqual(4.5);
  });

  it("reads the current crumb and tab label (primary ink) at 4.5:1", () => {
    for (const ground of GROUNDS) expect(contrastRatio(n("text-primary"), n(ground)), ground).toBeGreaterThanOrEqual(4.5);
  });

  it("holds the dirty dot, a state indicator, at 3:1: muted on every tab ground, the accent on the current tile", () => {
    for (const ground of GROUNDS) expect(contrastRatio(n("text-muted"), n(ground)), `muted on ${ground}`).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(neutrals.accent[theme], n("bg-tile")), "accent on tile").toBeGreaterThanOrEqual(3);
  });
});
