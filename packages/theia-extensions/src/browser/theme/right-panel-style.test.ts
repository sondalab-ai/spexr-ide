import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { RIGHT_PANEL } from "../shell/workbench-geometry.js";
import { contrastRatio, fromOklch, toOklch } from "./contrast-util.js";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const css = read("../style/spexr.css").replace(/\/\*[\s\S]*?\*\//g, "");
const kitDir = dirname(createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.js"));
const kitFile = (name: string): string => readFileSync(join(kitDir, name), "utf8");

/** Every `selector { declarations }` pair of spexr.css, comments stripped, selectors whitespace-collapsed. */
const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim().replace(/\s+/g, " "), body: m[2]! }));

/** The declarations of every rule whose selector list holds exactly `selector`. */
function rules(selector: string): string {
  const found = RULES.filter((r) => r.selector.split(/\s*,\s*/).includes(selector)).map((r) => r.body);
  expect(found.length, `${selector} not found in spexr.css`).toBeGreaterThan(0);
  return found.join("\n");
}

/** A length of a declaration as px (`12px`, or `0.75rem` at the kit's 16px to the rem; the kit's --sl-text-xs is 12px). */
function px(body: string, name: string): number {
  const m = new RegExp(`(?:^|[\\s;])${name}:\\s*([\\d.]+)(px|rem)?`).exec(body);
  expect(m, `${name} in ${body.slice(0, 160)}`).not.toBeNull();
  return Number(m![1]) * (m![2] === "rem" ? 16 : 1);
}

const PANEL_SELECTORS = RULES.filter((r) => /\.spexr-(panel-|memory-(list|panel)|experts-(list|panel)|todo)/.test(r.selector));

// The numbers repeat shell/workbench-geometry.ts's RIGHT_PANEL: CSS cannot read it.
describe("the right island's views in spexr.css", () => {
  it("finds the rules it is meant to check", () => {
    expect(PANEL_SELECTORS.length).toBeGreaterThan(15);
  });

  it("is the table's head: 12px above and below, 16px in, a 16px eyebrow line 4px over a 24px title", () => {
    const head = rules(".spexr-panel-head");
    expect(px(head, "padding-block")).toBe(RIGHT_PANEL.headPaddingBlock);
    expect(px(head, "padding-inline")).toBe(RIGHT_PANEL.inline);
    expect(head).toMatch(/border-bottom:\s*1px solid var\(--sl-border-subtle\)/);
    const eyebrow = rules(".spexr-panel-head__eyebrow");
    expect(px(eyebrow, "line-height")).toBe(RIGHT_PANEL.eyebrowLine);
    expect(eyebrow).toMatch(new RegExp(`margin:\\s*0 0 ${RIGHT_PANEL.eyebrowGap}px`));
    const title = rules(".spexr-panel-head__title");
    expect(px(title, "font-size")).toBe(RIGHT_PANEL.titleSize);
    expect(px(title, "line-height")).toBe(RIGHT_PANEL.titleLine);
    expect(title).toMatch(/font-weight:\s*600/);
    expect(title).toMatch(/letter-spacing:\s*-0\.025em/);
  });

  it("is the table's body: 16px of padding", () => {
    expect(px(rules(".spexr-panel-body"), "padding")).toBe(RIGHT_PANEL.bodyPadding);
  });

  it("is the table's card: r8 on the kit's control edge, on the raised ground, clipping its rows", () => {
    for (const card of [".spexr-memory-list", ".spexr-experts-list", ".spexr-todo__file"]) {
      const body = rules(card);
      expect(px(body, "border-radius"), card).toBe(RIGHT_PANEL.cardRadius);
      expect(body, card).toMatch(/box-shadow:\s*0 0 0 1px var\(--slc-edge-control\)/);
      expect(body, card).toMatch(/background:\s*var\(--slc-raised\)/);
      expect(body, card).toMatch(/overflow:\s*hidden/);
    }
  });

  // The card's outline is a boundary and reads 3:1 (below). The rows' separators
  // are deliberately NOT held to 3:1: they are faint structural hairlines
  // (--sl-border-subtle, 1.1-1.3:1), as in the demo, a waiver the owner has
  // accepted for S5e.
  it("is the table's row: 32px at least, 8px above and below, 12px in, apart by a faint hairline and never a gap", () => {
    for (const row of [".spexr-memory-list__item", ".spexr-experts-list__item"]) {
      const body = rules(row);
      expect(px(body, "min-height"), row).toBe(RIGHT_PANEL.rowMinHeight);
      expect(px(body, "padding-block"), row).toBe(RIGHT_PANEL.rowPaddingBlock);
      expect(px(body, "padding-inline"), row).toBe(RIGHT_PANEL.rowPaddingInline);
      expect(rules(`${row} + ${row}`), row).toMatch(/border-top:\s*1px solid var\(--sl-border-subtle\)/);
    }
    for (const list of [".spexr-memory-list", ".spexr-experts-list"]) expect(rules(list), list).not.toMatch(/(^|[\s;])gap:/);
    expect(rules(".spexr-todo__item")).toMatch(/border-bottom:\s*1px solid var\(--sl-border-subtle\)/);
    expect(px(rules(".spexr-todo__item"), "padding-block")).toBe(RIGHT_PANEL.rowPaddingBlock);
    // The TODO rows run full-bleed in their card like the others: the inset is on the rows, not the card.
    expect(px(rules(".spexr-todo__file .spexr-todo__item"), "padding-inline")).toBe(RIGHT_PANEL.rowPaddingInline);
    expect(rules(".spexr-todo__file")).not.toMatch(/padding/);
  });

  it("is the table's name: the mono, 12px at 500 on a 16px line, in the primary ink", () => {
    expect(kitFile("tokens.css")).toMatch(/--sl-text-xs:\s*0\.75rem/);
    for (const name of [".spexr-memory-list__name", ".spexr-experts-list__name"]) {
      const body = rules(name);
      expect(body, name).toMatch(/font-family:\s*var\(--sl-font-mono\)/);
      expect(body, name).toMatch(/font-size:\s*var\(--sl-text-xs\)/);
      expect(body, name).toMatch(/font-weight:\s*500/);
      expect(px(body, "line-height"), name).toBe(RIGHT_PANEL.nameLine);
      expect(body, name).toMatch(/color:\s*var\(--slc-text\)/);
    }
    expect(rules(".spexr-todo__folder")).toMatch(/font-family:\s*var\(--sl-font-mono\)/);
  });

  it("writes no colour literal", () => {
    for (const { selector, body } of PANEL_SELECTORS) {
      expect(body, selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(body, selector).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch)\(/);
      expect(body, selector).not.toMatch(/\boklch\(\s*[\d.]/);
      expect(body, selector).not.toMatch(/:\s*(white|black|red|gray|grey|blue|green)\b/);
    }
  });

  it("stands the active expert on the kit's seam: a current list row, the accent whether or not focus is in", () => {
    expect(rules(".spexr-experts-list__item")).toMatch(/--sl-seam-focus:\s*1;/);
    // The kit's row is 100% wide: without border-box its padding pushes it out of the card, clipped.
    expect(rules(".spexr-experts-list__item")).toMatch(/box-sizing:\s*border-box;/);
    expect(rules(".spexr-experts-list__item[aria-current] .spexr-experts-list__icon")).toMatch(/color:\s*var\(--slc-accent-text\)/);
    expect(kitFile("components.css")).toMatch(/\.sl-list__row:is\(\[aria-selected="true"\], \[aria-current\]:not\(\[aria-current="false"\]\)\),/);
  });

  it("leaves a small button's type to the kit", () => {
    expect(rules(".sl-btn--sm")).not.toMatch(/font-size/);
    expect(rules(".sl-btn--sm")).toMatch(/padding:/);
  });

  it("gives the three views no glass ground, which only a glass button needed", () => {
    const ground = RULES.find((r) => r.body.includes("var(--spexr-glass-ground)") && r.selector.includes(".spexr-spec-widget"));
    expect(ground).toBeDefined();
    for (const widget of ["memory", "experts", "todo"]) expect(ground!.selector).not.toContain(`.spexr-${widget}-widget`);
  });
});

describe("the right island's view sources", () => {
  const sources = { memory: "../views/memory-widget.tsx", experts: "../views/experts-widget.tsx", todo: "../todo/todo-widget.tsx" };

  it.each(Object.entries(sources))("%s has a head, no glass on its buttons and no per-item colour", (name, file) => {
    const src = read(file);
    expect(src, name).toMatch(/<PanelHead eyebrow=\{\w+\} title=\{\w+\}/);
    expect(src.match(/nls\.localize\("spexr\/\w+\/(eyebrow|title)"/g)!.length, `${name} localises its head`).toBeGreaterThanOrEqual(2);
    expect(src, name).not.toMatch(/aria-label="TODO"/);
    expect(src, name).not.toMatch(/sl-fx-glass/);
    expect(src, name).not.toMatch(/\be\.color\b|borderColor|style=\{\{\s*color/);
  });

  it("takes Theia's title row off the three views, which name themselves", () => {
    const src = read("../shell/panel-title-contribution.ts");
    expect(src).toMatch(/new Set\(\[MEMORY_VIEW_ID, EXPERTS_VIEW_ID, TODO_VIEW_ID\]\)/);
  });

  it("marks the active expert as the current row, on the kit's row class", () => {
    const src = read("../views/experts-widget.tsx");
    expect(src).toMatch(/className="sl-list__row spexr-experts-list__item"\s+aria-current=\{isActive \? "true" : undefined\}/);
  });
});

type Theme = "dark" | "light";
const THEMES: readonly Theme[] = ["dark", "light"];
const neutrals = kitNeutrals.products.spexr as unknown as Record<Theme, Record<string, string>>;
const accentFill = kitNeutrals.products.spexr.fill as Record<Theme, string>;

/** The kit's neutral a role var names (`--slc-text-muted`, `--sl-bg-surface-raised` ...), as neutrals.json keys it. */
function neutral(theme: Theme, role: string): string {
  const key = {
    "slc-text": "text-primary", "sl-text-primary": "text-primary",
    "slc-text-secondary": "text-secondary", "sl-text-secondary": "text-secondary",
    "slc-text-muted": "text-muted", "sl-text-muted": "text-muted",
    "slc-surface": "bg-surface", "sl-bg-surface": "bg-surface",
    "slc-raised": "bg-surface-raised", "sl-bg-surface-raised": "bg-surface-raised",
    "slc-tile": "bg-tile", "sl-bg-tile": "bg-tile",
  }[role];
  expect(key, `no neutral for --${role}`).toBeDefined();
  const hex = neutrals[theme][key!];
  expect(hex, `${key} on ${theme}`).toMatch(/^#[0-9a-f]{6}$/);
  return hex!;
}

/** The role a rule's `color:` names, found in spexr.css, or in the kit's `.sl-eyebrow` for a class that wears it. */
function inkRole(selector: string): string {
  const m = /(?:^|[\s;])color:\s*var\(--([a-z-]+)\)/.exec(rules(selector));
  expect(m, `${selector} has no role colour`).not.toBeNull();
  return m![1]!;
}

// The owner's rules: text at least 4.5:1, a boundary or a state indicator at least 3:1.
describe.each(THEMES)("the right island's views on %s", (theme) => {
  // Grounds a view's text sits on: the island's surface, the lit island's raised fill, a card's raised, the current row's tile.
  const GROUNDS = ["slc-surface", "slc-raised", "slc-tile"] as const;
  const TEXT: Array<[string, readonly (typeof GROUNDS)[number][]]> = [
    [".spexr-panel-head__title", ["slc-surface", "slc-raised"]],
    [".spexr-memory-list__name", ["slc-raised", "slc-tile"]],
    [".spexr-experts-list__name", ["slc-raised", "slc-tile"]],
    [".spexr-memory-list__filename", ["slc-raised"]],
    [".spexr-todo__folder", ["slc-raised"]],
    [".spexr-todo__empty", ["slc-raised", "slc-surface"]],
    [".spexr-todo__title", ["slc-raised"]],
  ];

  it.each(TEXT)("reads %s at 4.5:1 on its grounds", (selector, grounds) => {
    const ink = neutral(theme, inkRole(selector));
    for (const ground of grounds) expect(contrastRatio(ink, neutral(theme, ground)), `${selector} on ${ground}`).toBeGreaterThanOrEqual(4.5);
  });

  it("reads the eyebrow, the hints, a description and a card's empty state at 4.5:1 on every ground", () => {
    // The kit's .sl-eyebrow is the muted ink; the hints and descriptions name theirs in spexr.css.
    expect(kitFile("components.css")).toMatch(/\.sl-eyebrow \{[^}]*color:\s*var\(--slc-text-muted\)/);
    const inks = ["slc-text-muted", inkRole(".spexr-memory-panel__hint"), inkRole(".spexr-memory-list__desc"), inkRole(".spexr-experts-list__desc"), inkRole(".spexr-todo__empty")];
    for (const role of inks) for (const ground of GROUNDS) expect(contrastRatio(neutral(theme, role), neutral(theme, ground)), `--${role} on ${ground}`).toBeGreaterThanOrEqual(4.5);
  });

  it("reads the active expert's accent icon at 4.5:1 on its tile and on the raised ground", () => {
    const light = theme === "light";
    // --slc-accent-text: the accent itself on dark; on light its lightness is capped (themes/light.css).
    const accent = kitNeutrals.products.spexr.accent[theme];
    const cap = Number(/--sl-accent-text-lmax:\s*([\d.]+)/.exec(kitFile("themes/light.css"))![1]);
    const [L, C, h] = toOklch(accent);
    const ink = light ? fromOklch([Math.min(L, cap), C, h]) : accent;
    for (const ground of ["slc-raised", "slc-tile"]) expect(contrastRatio(ink, neutral(theme, ground)), ground).toBeGreaterThanOrEqual(4.5);
  });

  it("draws the active expert's live dot at 3:1 on the raised ground and the tile", () => {
    const status = new RegExp(`--sl-status-success:\\s*(#[0-9a-f]{6})`).exec(kitFile(`themes/${theme}.css`))![1]!;
    for (const ground of ["slc-raised", "slc-tile"]) expect(contrastRatio(status, neutral(theme, ground)), ground).toBeGreaterThanOrEqual(3);
  });

  /** --slc-edge-control (components.css): the surface's lightness stepped 5 shades away (and a half more on paper). */
  function controlEdge(): string {
    const k = kitFile("components.css");
    const step = Number(/--slc-shade-step:\s*([\d.]+)/.exec(k)![1]);
    const steps = Number(/--slc-edge-control-steps:\s*([\d.]+)/.exec(k)![1]);
    const [L, C, h] = toOklch(neutral(theme, "slc-surface"));
    return fromOklch([theme === "dark" ? L + step * steps : L - step * (steps + 0.5), C, h]);
  }

  it("outlines a card at 3:1 against the island outside it and the raised ground inside", () => {
    const edge = controlEdge();
    for (const ground of ["slc-surface", "slc-raised"]) expect(contrastRatio(edge, neutral(theme, ground)), `card edge on ${ground}`).toBeGreaterThanOrEqual(3);
  });

  it("draws a check box on a card at 3:1: its edge, and its fill once checked", () => {
    const edge = controlEdge();
    expect(contrastRatio(edge, neutral(theme, "slc-raised")), "edge").toBeGreaterThanOrEqual(3);
    expect(contrastRatio(accentFill[theme], neutral(theme, "slc-raised")), "checked fill").toBeGreaterThanOrEqual(3);
  });
});
