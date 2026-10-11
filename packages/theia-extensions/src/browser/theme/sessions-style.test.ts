import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { AGENT_LOG, AGENTS_PILL, SESSIONS } from "../shell/workbench-geometry.js";
import { contrastRatio, fromOklch, toOklch } from "./contrast-util.js";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const css = read("../style/spexr.css").replace(/\/\*[\s\S]*?\*\//g, "");
const kitDir = dirname(createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.js"));
const kitFile = (name: string): string => readFileSync(join(kitDir, name), "utf8");
const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim().replace(/\s+/g, " "), body: m[2]! }));

function rules(selector: string): string {
  const found = RULES.filter((r) => r.selector.split(/\s*,\s*(?![^(]*\))/).includes(selector)).map((r) => r.body);
  expect(found.length, `${selector} not found in spexr.css`).toBeGreaterThan(0);
  return found.join("\n");
}

function px(body: string, name: string): number {
  const m = new RegExp(`(?:^|[\\s;])${name}:\\s*([\\d.]+)(px|rem)?`).exec(body);
  expect(m, `${name} in ${body.slice(0, 160)}`).not.toBeNull();
  return Number(m![1]) * (m![2] === "rem" ? 16 : 1);
}

const OWN = RULES.filter((r) => /spexr-sessions|spexr-status--agents|spexr-agent-log|spexr-df-term__time/.test(r.selector));

// The numbers repeat SESSIONS, AGENTS_PILL and AGENT_LOG in shell/workbench-geometry.ts: CSS cannot read them.
describe("the sessions part, the agents pill and the agent log in spexr.css", () => {
  it("finds the rules it is meant to check", () => {
    expect(OWN.length).toBeGreaterThan(12);
  });

  it("is the table's row: 48px high, 4px by 8px of padding, r6, a 13px sans name on a 20px line, no gap between rows", () => {
    const row = rules(".spexr-sessions__row.sl-list__row");
    expect(px(row, "min-height")).toBe(SESSIONS.rowHeight);
    expect(px(row, "padding-block")).toBe(SESSIONS.rowPaddingBlock);
    expect(px(row, "padding-inline")).toBe(SESSIONS.rowPaddingInline);
    expect(px(row, "border-radius")).toBe(SESSIONS.rowRadius);
    expect(px(row, "font-size")).toBe(SESSIONS.nameSize);
    expect(px(rules(".spexr-sessions__name"), "line-height")).toBe(SESSIONS.nameLine);
    const list = rules(".spexr-sessions.sl-list");
    expect(px(list, "gap")).toBe(SESSIONS.rowGap);
    expect(px(list, "padding-inline")).toBe(SESSIONS.listPaddingInline);
    // 4 + 20 + 4 + 16 + 4: the row's parts add up to its height.
    expect(SESSIONS.rowPaddingBlock * 2 + SESSIONS.nameLine + SESSIONS.metaGap + SESSIONS.metaLine).toBe(SESSIONS.rowHeight);
  });

  it("is the table's meta: the mono at 11px on a 16px line, 4px under the name", () => {
    const meta = rules(".spexr-sessions__meta.sl-list__meta");
    expect(meta).toMatch(/font-family:\s*var\(--sl-font-mono\)/);
    expect(px(meta, "font-size")).toBe(SESSIONS.metaSize);
    expect(px(meta, "line-height")).toBe(SESSIONS.metaLine);
    expect(px(meta, "margin-top")).toBe(SESSIONS.metaGap);
  });

  it("keeps the table on the 4px grid", () => {
    for (const v of [SESSIONS.rowHeight, SESSIONS.rowPaddingBlock, SESSIONS.rowPaddingInline, SESSIONS.listPaddingInline, SESSIONS.nameLine, SESSIONS.metaLine, SESSIONS.metaGap, AGENT_LOG.padding, AGENT_LOG.line, AGENT_LOG.gap]) {
      expect(v % 4, `${v}`).toBe(0);
    }
  });

  it("rings the pill on the control edge on the sunken ground at r6, with the primary ink, and gives it a 6px dot through the live item", () => {
    const pill = rules("#theia-statusBar .area:is(.left, .right) > .element.spexr-status--agents");
    expect(pill).toMatch(/background-color:\s*var\(--slc-sunken\)/);
    expect(pill).toMatch(/box-shadow:\s*0 0 0 1px var\(--slc-edge-control\)/);
    expect(px(pill, "border-radius")).toBe(AGENTS_PILL.radius);
    expect(rules("#theia-statusBar .area:is(.left, .right) > .element.spexr-status--agents > span:not(.codicon, .fa)")).toMatch(/color:\s*var\(--slc-text\)/);
    expect(read("../sessions/agents-status-contribution.ts")).toMatch(/statusClass\(\{ live: true, agents: true \}\)/);
    expect(css).toMatch(new RegExp(`\\.element\\.spexr-status--live::after \\{[^}]*width:\\s*${AGENTS_PILL.dot}px`));
  });

  it("is the log's gutter and line: 16px in, 20px lines, a time column of eight characters of the mono, 12px before the text", () => {
    const log = rules(".spexr-agent-log");
    expect(log).toMatch(/overflow-y:\s*auto/);
    expect(log).toMatch(/height:\s*100%/);
    expect(px(log, "padding")).toBe(AGENT_LOG.padding);
    expect(px(rules(".spexr-agent-log .spexr-df-term"), "line-height")).toBe(AGENT_LOG.line);
    expect(px(rules(".spexr-agent-log .spexr-df-term__line"), "gap")).toBe(AGENT_LOG.gap);
    expect(rules(".spexr-df-term__time")).toMatch(new RegExp(`width:\\s*${AGENT_LOG.timeChars}ch`));
  });

  it("does not animate, and writes no colour literal", () => {
    for (const { selector, body } of OWN) {
      expect(body, selector).not.toMatch(/\banimation\b|\btransition\b/);
      expect(body, selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(body, selector).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch)\(/);
      expect(body, selector).not.toMatch(/\boklch\(\s*[\d.]/);
    }
  });
});

describe("the sessions part's sources", () => {
  it("builds the rows from the kit's list: a listbox of options, the selected one aria-selected, one tab stop", () => {
    const src = read("../sessions/sessions-widget.tsx");
    expect(src).toMatch(/className="sl-list spexr-sessions"/);
    expect(src).toMatch(/role="listbox"/);
    expect(src).toMatch(/className="sl-list__row spexr-sessions__row"/);
    expect(src).toMatch(/role="option"/);
    expect(src).toMatch(/aria-selected=\{r\.sessionId === selected\}/);
    expect(src).toMatch(/tabIndex=\{r\.sessionId === stop \? 0 : -1\}/);
    expect(src).not.toMatch(/style=\{\{/);
  });

  it("shows the log with the time before each line, through the follow transcript", () => {
    expect(read("../sessions/agent-log-widget.tsx")).toMatch(/<FollowTranscript events=\{this\.events\} showTime \/>/);
    expect(read("../darkfactory/agent-tile.tsx")).toMatch(/\{showTime && e\.atMs !== undefined && \(/);
  });

  it("caps the rate at 500 tok/s on the backend, where the fixture's 86 and the demo's 1.2k are told apart", () => {
    expect(read("../../node/darkfactory/agent-events.ts")).toMatch(/MAX_PLAUSIBLE_TOK_PER_SEC = 500/);
  });

  it("opens a session that is not the agent's through Dark Factory, and only in a trusted workspace", () => {
    const src = read("../agent-pane/agent-pane-widget.tsx");
    const open = /private async openFollowedInTerminal[\s\S]*?\n  }/.exec(src)![0];
    expect(open.indexOf("isTrusted()")).toBeGreaterThan(-1);
    expect(open.indexOf("isTrusted()")).toBeLessThan(open.indexOf("executeCommand"));
    expect(open).toMatch(/DARKFACTORY_OPEN_SESSION_COMMAND\.id/);
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

// The owner's rules: text at least 4.5:1; a boundary or a state indicator at least 3:1.
describe.each(THEMES)("the sessions part, the pill and the log on %s", (theme) => {
  const surface = neutral(theme, "bg-surface");
  const canvas = neutral(theme, "bg-canvas");
  const sunken = neutral(theme, "bg-sunken");
  const tile = neutral(theme, "bg-tile");
  const text = neutral(theme, "text-primary");
  const secondary = neutral(theme, "text-secondary");
  const muted = neutral(theme, "text-muted");
  const accent = kitNeutrals.products.spexr.accent[theme];
  const accentInk = ((): string => {
    if (theme === "dark") return accent;
    const cap = Number(/--sl-accent-text-lmax:\s*([\d.]+)/.exec(kitFile("themes/light.css"))![1]);
    const [L, C, h] = toOklch(accent);
    return fromOklch([Math.min(L, cap), C, h]);
  })();
  const danger = status(theme, "danger");
  const edge = ((): string => {
    const k = kitFile("components.css");
    const step = Number(/--slc-shade-step:\s*([\d.]+)/.exec(k)![1]);
    const steps = Number(/--slc-edge-control-steps:\s*([\d.]+)/.exec(k)![1]);
    const [L, C, h] = toOklch(surface);
    return fromOklch([theme === "dark" ? L + step * steps : L - step * (steps + 0.5), C, h]);
  })();
  const atLeast = (min: number, ink: string, ground: string, label: string): void => {
    expect(contrastRatio(ink, ground), label).toBeGreaterThanOrEqual(min);
  };

  it("reads a row's name and meta at 4.5:1 on the island, and on the selected tile", () => {
    atLeast(4.5, text, surface, "name");
    atLeast(4.5, muted, surface, "meta");
    atLeast(4.5, text, tile, "selected name");
    atLeast(4.5, secondary, tile, "selected meta");
  });

  it("reads a running row's meta, in the accent ink, at 4.5:1 on the island and on the selected tile", () => {
    expect(rules('.spexr-sessions__row[data-state="running"] .spexr-sessions__meta')).toMatch(/color:\s*var\(--slc-accent-text\)/);
    atLeast(4.5, accentInk, surface, "running meta");
    atLeast(4.5, accentInk, tile, "running meta, selected");
  });

  it("draws the selected row's seam, in the muted ink while the list is not focused, at 3:1 on its tile", () => {
    atLeast(3, muted, tile, "seam, list unfocused");
    atLeast(3, accentInk, tile, "seam, list focused");
  });

  it("reads the pill's words at 4.5:1 on the sunken ground, its dot at 3:1, and its ring at 3:1 on the bar", () => {
    atLeast(4.5, text, sunken, "pill words");
    atLeast(3, accentInk, sunken, "pill dot");
    atLeast(3, edge, canvas, "pill ring on the bar");
  });

  it("reads the model item at 4.5:1 on the bar", () => {
    atLeast(4.5, text, canvas, "model item");
  });

  it("reads the log at 4.5:1: the prompt and the replies, the calls in the accent ink, the results and the time, a failure", () => {
    atLeast(4.5, text, surface, "prompt and reply");
    atLeast(4.5, accentInk, surface, "call");
    atLeast(4.5, muted, surface, "result and time");
    atLeast(4.5, danger, surface, "failure");
    expect(rules(".spexr-df-term__time")).toMatch(/color:\s*var\(--slc-text-muted\)/);
    expect(rules('.spexr-agent-log .spexr-df-term__line[data-kind="error"]')).toMatch(/color:\s*var\(--slc-danger-text, var\(--slc-danger\)\)/);
  });
});
