import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { AGENT_PANE, AGENT_PANE_RANK, RIGHT_PANEL } from "../shell/workbench-geometry.js";
import { contrastRatio, fromOklch, toOklch } from "./contrast-util.js";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const css = read("../style/spexr.css").replace(/\/\*[\s\S]*?\*\//g, "");
const kitDir = dirname(createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.js"));
const kitFile = (name: string): string => readFileSync(join(kitDir, name), "utf8");

const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim().replace(/\s+/g, " "), body: m[2]! }));

/** The declarations of every rule whose selector list holds exactly `selector`. */
function rules(selector: string): string {
  const found = RULES.filter((r) => r.selector.split(/\s*,\s*/).includes(selector)).map((r) => r.body);
  expect(found.length, `${selector} not found in spexr.css`).toBeGreaterThan(0);
  return found.join("\n");
}

function px(body: string, name: string): number {
  const m = new RegExp(`(?:^|[\\s;])${name}:\\s*([\\d.]+)(px|rem)?`).exec(body);
  expect(m, `${name} in ${body.slice(0, 160)}`).not.toBeNull();
  return Number(m![1]) * (m![2] === "rem" ? 16 : 1);
}

const AGENT_SELECTORS = RULES.filter((r) => /\.spexr-agent-|\.spexr-panel-head--aside|\.spexr-panel-head__text/.test(r.selector));

// The numbers repeat shell/workbench-geometry.ts's AGENT_PANE: CSS cannot read it.
describe("the agent pane in spexr.css", () => {
  it("finds the rules it is meant to check", () => {
    expect(AGENT_SELECTORS.length).toBeGreaterThan(25);
  });

  it("is the table's log: 16px in, 16px between its blocks", () => {
    const log = rules(".spexr-agent-pane__log");
    expect(px(log, "padding")).toBe(AGENT_PANE.logPadding);
    expect(px(log, "gap")).toBe(AGENT_PANE.logGap);
  });

  it("is the table's prompt: r8 with an r4 corner, 8px by 12px of padding, 13.5px on a 1.55 line, on the tile", () => {
    const prompt = rules(".spexr-agent-prompt");
    expect(prompt).toMatch(new RegExp(`border-radius:\\s*${AGENT_PANE.promptRadius}px ${AGENT_PANE.promptRadius}px ${AGENT_PANE.promptRadius}px ${AGENT_PANE.promptCorner}px`));
    expect(prompt).toMatch(new RegExp(`padding:\\s*${AGENT_PANE.promptPaddingBlock}px ${AGENT_PANE.promptPaddingInline}px`));
    expect(prompt).toMatch(/background:\s*var\(--slc-tile\)/);
    const prose = rules(".spexr-agent-prose");
    expect(px(prose, "font-size")).toBe(AGENT_PANE.proseSize);
    expect(px(prose, "line-height")).toBe(AGENT_PANE.proseLeading);
  });

  it("is the right island's card: r8 on the control edge, on the raised ground, clipping its rows, for the tools and the diff", () => {
    for (const card of [".spexr-agent-tools__list", ".spexr-agent-diff"]) {
      const body = rules(card);
      expect(px(body, "border-radius"), card).toBe(RIGHT_PANEL.cardRadius);
      expect(body, card).toMatch(/box-shadow:\s*0 0 0 1px var\(--slc-edge-control\)/);
      expect(body, card).toMatch(/background:\s*var\(--slc-raised\)/);
      expect(body, card).toMatch(/overflow:\s*hidden/);
    }
  });

  it("is the right island's row: 32px at least, 8px above and below, 12px in, apart by a hairline and never a gap", () => {
    const row = rules(".spexr-agent-tool");
    expect(px(row, "min-height")).toBe(RIGHT_PANEL.rowMinHeight);
    expect(px(row, "padding-block")).toBe(RIGHT_PANEL.rowPaddingBlock);
    expect(px(row, "padding-inline")).toBe(RIGHT_PANEL.rowPaddingInline);
    expect(rules(".spexr-agent-tool + .spexr-agent-tool")).toMatch(/border-top:\s*1px solid var\(--sl-border-subtle\)/);
    expect(rules(".spexr-agent-tools__list")).not.toMatch(/(^|[\s;])gap:/);
  });

  it("gives a tool its target in the mono at 12px/500, its duration in the mono at the table's size, and a running row a 7% accent wash", () => {
    const target = rules(".spexr-agent-tool__target");
    expect(target).toMatch(/font-family:\s*var\(--sl-font-mono\)/);
    expect(target).toMatch(/font-size:\s*var\(--sl-text-xs\)/);
    expect(target).toMatch(/font-weight:\s*500/);
    expect(px(rules(".spexr-agent-tool__meta"), "font-size")).toBe(AGENT_PANE.metaSize);
    expect(rules('.spexr-agent-tool[data-state="run"]')).toMatch(/background:\s*color-mix\(in srgb, var\(--slc-accent\) 7%, var\(--slc-raised\)\)/);
    expect(rules('.spexr-agent-tool[data-state="run"] .spexr-agent-tool__meta')).toMatch(/color:\s*var\(--slc-accent-text\)/);
  });

  it("is the table's diff: 11.5px code on a 20px line, 4px above and below, 12px in, each changed line on a 10% wash", () => {
    expect(px(rules(".spexr-agent-diff"), "font-size")).toBe(AGENT_PANE.diffSize);
    const body = rules(".spexr-agent-diff__body");
    expect(px(body, "line-height")).toBe(AGENT_PANE.diffLine);
    expect(px(body, "padding")).toBe(AGENT_PANE.diffPaddingBlock);
    expect(px(rules(".spexr-agent-diff__row"), "padding-inline")).toBe(AGENT_PANE.diffInline);
    expect(rules(".spexr-agent-diff__row--add")).toMatch(/background:\s*color-mix\(in srgb, var\(--slc-success\) 10%, transparent\)/);
    expect(rules(".spexr-agent-diff__row--del")).toMatch(/background:\s*color-mix\(in srgb, var\(--slc-danger\) 10%, transparent\)/);
    expect(rules(".spexr-agent-diff__caption")).toMatch(new RegExp(`padding:\\s*${AGENT_PANE.captionPaddingBlock}px ${AGENT_PANE.diffInline}px`));
  });

  it("is the table's plan: its checks 8px apart, its labels 13px; and the model tag r6 at 11.5px", () => {
    expect(px(rules(".spexr-agent-plan"), "gap")).toBe(AGENT_PANE.planGap);
    expect(px(rules(".spexr-agent-plan__item .sl-check__label"), "font-size")).toBe(AGENT_PANE.planLabelSize);
    const tag = rules(".spexr-agent-pane__model");
    expect(px(tag, "font-size")).toBe(AGENT_PANE.modelSize);
    expect(px(tag, "border-radius")).toBe(AGENT_PANE.modelRadius);
  });

  it("rings the prompt on the kit's control edge, holds a long one to six lines and keeps its breaks", () => {
    const prompt = rules(".spexr-agent-prompt");
    expect(prompt).toMatch(/box-shadow:\s*0 0 0 1px var\(--slc-edge-control\)/);
    expect(prompt).toMatch(new RegExp(`-webkit-line-clamp:\\s*${AGENT_PANE.promptLines}`));
    expect(prompt).toMatch(/white-space:\s*pre-wrap/);
  });

  it("scrolls an expanded tool list past its height, never cuts an edit's size and gives the fold a 24px target", () => {
    expect(px(rules(".spexr-agent-tools__list"), "max-height")).toBe(AGENT_PANE.toolListMaxHeight);
    expect(rules(".spexr-agent-tools__list")).toMatch(/overflow-y:\s*auto/);
    expect(rules(".spexr-agent-stat")).toMatch(/flex:\s*none/);
    expect(px(rules(".spexr-agent-tools__fold"), "min-height")).toBe(AGENT_PANE.foldMinHeight);
  });

  it("does not animate: no transition, animation or keyframes", () => {
    for (const { selector, body } of AGENT_SELECTORS) {
      expect(body, selector).not.toMatch(/\banimation\b|\btransition\b/);
    }
  });

  it("writes no colour literal", () => {
    for (const { selector, body } of AGENT_SELECTORS) {
      expect(body, selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(body, selector).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch)\(/);
      expect(body, selector).not.toMatch(/\boklch\(\s*[\d.]/);
    }
  });
});

describe("the agent pane's sources", () => {
  it("has a head on PanelHead and localises its words", () => {
    const view = read("../agent-pane/agent-pane-view.tsx");
    expect(view).toMatch(/<PanelHead\s+eyebrow=/);
    expect(view).toMatch(/nls\.localize\("spexr\/agentPane\/needsYou", "Waiting for you in the terminal"\)/);
    expect(view).toMatch(/nls\.localize\("spexr\/agentPane\/reveal", "Reveal"\)/);
    expect(view).not.toMatch(/style=\{\{/);
  });

  it("is the first tile of the right island and takes the head's own title row off", () => {
    expect(read("../agent-pane/agent-pane-view-contribution.ts")).toMatch(/area:\s*"right",\s*rank:\s*AGENT_PANE_RANK/);
    expect(AGENT_PANE_RANK).toBeGreaterThan(0);
    expect(AGENT_PANE_RANK).toBeLessThan(1);
    expect(read("../shell/panel-title-contribution.ts")).toMatch(/AGENT_PANE_VIEW_ID/);
  });
});

type Theme = "dark" | "light";
const THEMES: readonly Theme[] = ["dark", "light"];
const neutrals = kitNeutrals.products.spexr as unknown as Record<Theme, Record<string, string>>;

const neutral = (theme: Theme, key: string): string => {
  const hex = neutrals[theme][key];
  expect(hex, `${key} on ${theme}`).toMatch(/^#[0-9a-f]{6}$/);
  return hex!;
};

const status = (theme: Theme, name: "success" | "danger"): string => new RegExp(`--sl-status-${name}:\\s*(#[0-9a-f]{6})`).exec(kitFile(`themes/${theme}.css`))![1]!;

/** The role names a rule's `color:` chain reads, in order: `var(--slc-success-text, var(--slc-success))` is [slc-success-text, slc-success]. */
function inkChain(selector: string): string[] {
  const m = /(?:^|[\s;])color:\s*(var\(.*\))\s*;?/.exec(rules(selector));
  expect(m, `${selector} has no role colour`).not.toBeNull();
  return [...m![1]!.matchAll(/--([a-z-]+)/g)].map((x) => x[1]!);
}

/** `color-mix(in srgb, fg pct%, bg)` of two opaque colours, per channel as the browser rounds it. */
function mix(fg: string, pct: number, bg: string): string {
  const ch = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [f, b] = [ch(fg), ch(bg)];
  return `#${f.map((c, i) => Math.round(c * (pct / 100) + b[i]! * (1 - pct / 100)).toString(16).padStart(2, "0")).join("")}`;
}

// The owner's rules: text at least 4.5:1, a state indicator at least 3:1.
describe.each(THEMES)("the agent pane on %s", (theme) => {
  const surface = neutral(theme, "bg-surface");
  const raised = neutral(theme, "bg-surface-raised");
  const tile = neutral(theme, "bg-tile");
  const accent = kitNeutrals.products.spexr.accent[theme];
  const accentInk = ((): string => {
    if (theme === "dark") return accent;
    const cap = Number(/--sl-accent-text-lmax:\s*([\d.]+)/.exec(kitFile("themes/light.css"))![1]);
    const [L, C, h] = toOklch(accent);
    return fromOklch([Math.min(L, cap), C, h]);
  })();
  /**
   * The ink a rule paints, from the roles its own `color:` names, so the test
   * reads what the CSS renders: the first role the kit defines wins, as `var()`
   * with a fallback does. The kit declares `--slc-success-text` and
   * `--slc-danger-text` only inside the accent band's rule (asserted), so
   * elsewhere those fall back to the status colours.
   */
  const ink = (selector: string): string => {
    const known: Record<string, string> = {
      "slc-text": neutral(theme, "text-primary"),
      "slc-text-secondary": neutral(theme, "text-secondary"),
      "slc-text-muted": neutral(theme, "text-muted"),
      "slc-accent-text": accentInk,
      "slc-success": status(theme, "success"),
      "slc-danger": status(theme, "danger"),
    };
    for (const role of inkChain(selector)) {
      if (role === "slc-success-text" || role === "slc-danger-text") {
        // Declared only inside the accent band's own rule (components.css); outside it the CSS falls back to the status role.
        const kit = kitFile("components.css");
        const at = kit.indexOf(`--${role}:`);
        const selector = kit.slice(kit.lastIndexOf("}", at) + 1, kit.lastIndexOf("{", at));
        expect(selector, `--${role} is declared outside a band: read it here`).toMatch(/band/i);
        continue;
      }
      if (known[role]) return known[role]!;
    }
    throw new Error(`${selector}: no known role in ${inkChain(selector).join(", ")}`);
  };
  const text = ink(".spexr-agent-prompt");
  const secondary = ink(".spexr-agent-tool");
  const muted = ink(".spexr-agent-tool__meta");
  const success = ink(".spexr-agent-stat i");
  const danger = ink(".spexr-agent-stat s");
  const accentText = ink('.spexr-agent-tool[data-state="run"] .spexr-agent-tool__meta');
  const addInk = ink(".spexr-agent-diff__row--add");
  const delInk = ink(".spexr-agent-diff__row--del");
  const captionInk = ink(".spexr-agent-diff__caption");
  const running = mix(accent, 7, raised);
  const addWash = mix(status(theme, "success"), 10, raised);
  const delWash = mix(status(theme, "danger"), 10, raised);
  const captionWash = mix(text, 4, raised);

  const atLeast = (min: number, ink: string, ground: string, label: string): void => {
    expect(contrastRatio(ink, ground), label).toBeGreaterThanOrEqual(min);
  };

  it("reads the prompt, the prose and the head's ink at 4.5:1 on their grounds", () => {
    atLeast(4.5, text, tile, "prompt on the tile");
    atLeast(4.5, ink(".spexr-agent-prose"), surface, "prose");
    atLeast(4.5, text, surface, "prose on the island");
    atLeast(4.5, ink(".spexr-agent-tools__fold"), surface, "the fold on the island");
    atLeast(4.5, neutral(theme, "text-muted"), surface, "the plan's eyebrow and the id on the island");
    atLeast(4.5, ink(".spexr-agent-pane__hint"), surface, "the empty hint");
  });

  it("reads a tool row at 4.5:1 on the raised ground and on a running row's wash", () => {
    for (const [ground, name] of [[raised, "raised"], [running, "running wash"]] as const) {
      atLeast(4.5, text, ground, `target on ${name}`);
      atLeast(4.5, secondary, ground, `verb on ${name}`);
      atLeast(4.5, muted, ground, `duration on ${name}`);
      atLeast(4.5, success, ground, `+n on ${name}`);
      atLeast(4.5, danger, ground, `-m on ${name}`);
    }
    atLeast(4.5, accentText, running, `"running" in the accent ink on its wash`);
  });

  it("draws a tool's glyph at 3:1: done in success, running in the accent, a failure in danger", () => {
    atLeast(3, success, raised, "done glyph");
    atLeast(3, accentText, running, "running glyph");
    atLeast(3, danger, raised, "failed glyph");
  });

  it("reads the diff at 4.5:1: the added and removed lines on their washes, the caption on its own", () => {
    atLeast(4.5, addInk, addWash, "added line");
    atLeast(4.5, delInk, delWash, "removed line");
    atLeast(4.5, captionInk, captionWash, "caption");
    atLeast(4.5, success, captionWash, "+n in the caption");
    atLeast(4.5, danger, captionWash, "-m in the caption");
  });

  it("reads the needs-you row at 4.5:1, and its icon at 3:1", () => {
    atLeast(4.5, ink(".spexr-agent-needs"), raised, "words");
    atLeast(3, ink(".spexr-agent-needs__icon"), raised, "icon");
  });

  /** --slc-edge-control (components.css): the surface's lightness stepped 5 shades away (and a half more on paper). */
  function controlEdge(): string {
    const k = kitFile("components.css");
    const step = Number(/--slc-shade-step:\s*([\d.]+)/.exec(k)![1]);
    const steps = Number(/--slc-edge-control-steps:\s*([\d.]+)/.exec(k)![1]);
    const [L, C, h] = toOklch(surface);
    return fromOklch([theme === "dark" ? L + step * steps : L - step * (steps + 0.5), C, h]);
  }

  it("rings the prompt card at 3:1 on the kit's control edge, against the island outside and the tile inside", () => {
    const edge = controlEdge();
    atLeast(3, edge, surface, "edge on the island");
    atLeast(3, edge, tile, "edge on the tile");
  });

  it("reads the model tag at 4.5:1 on its accent wash", () => {
    atLeast(4.5, accentText, mix(accent, 16, surface), "tag");
  });
});
