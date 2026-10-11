import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { WORKBENCH } from "../shell/workbench-geometry.js";
import { KIT_STATUS_TONES, accentText } from "./spexr-accent.js";
import { contrastRatio } from "./contrast-util.js";

const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");

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

const CHIP = ':root:not([data-sl-theme="high-contrast"]) #theia-bottom-content-panel .lm-TabBar .lm-TabBar-tab .theia-badge-decorator-horizontal';

describe("the bottom panel in spexr.css (S6e)", () => {
  it("is the table's chip: 16px high and at least, r6, the mono at 10px", () => {
    const chip = rule(CHIP);
    expect(px(chip, "height")).toBe(WORKBENCH.panelChip);
    expect(px(chip, "min-width")).toBe(WORKBENCH.panelChip);
    expect(px(chip, "border-radius")).toBe(6);
    expect(chip).toMatch(/font:\s*500 10px\/16px var\(--sl-font-mono\)/);
  });

  it("tints the chip with the tone on its 18% wash: warning for warnings, danger for errors", () => {
    const warning = rule(`:root:not([data-sl-theme="high-contrast"]) #theia-bottom-content-panel .lm-TabBar .lm-TabBar-tab[data-severity="warning"] .theia-badge-decorator-horizontal`);
    expect(warning).toContain("color: var(--sl-status-warning)");
    expect(warning).toContain("color-mix(in srgb, var(--sl-status-warning) 18%, transparent)");
    const danger = rule(`:root:not([data-sl-theme="high-contrast"]) #theia-bottom-content-panel .lm-TabBar .lm-TabBar-tab[data-severity="error"] .theia-badge-decorator-horizontal`);
    expect(danger).toContain("color: var(--sl-status-danger)");
    expect(danger).toContain("color-mix(in srgb, var(--sl-status-danger) 18%, transparent)");
  });

  it("is the table's 24px panel buttons", () => {
    const button = rule("#theia-bottom-content-panel .lm-TabBar-toolbar .item:has(> :is(.codicon-add, .codicon-close))");
    expect(px(button, "width")).toBe(WORKBENCH.panelButton);
    expect(px(button, "height")).toBe(WORKBENCH.panelButton);
  });
});

type Theme = "dark" | "light";
const neutrals = kitNeutrals.products.spexr as unknown as Record<Theme, Record<string, string>>;

/** `top` at `pct`% over `ground`, as color-mix(in srgb, top pct%, transparent) over it. */
function wash(top: string, ground: string, pct: number): string {
  const c = (hex: string, i: number): number => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(c(ground, i) + (c(top, i) - c(ground, i)) * (pct / 100)).toString(16).padStart(2, "0")).join("")}`;
}

// The owner's rule: text at least 4.5:1. The chip's number is the tone on its own wash, over each ground a bottom tab can have.
describe.each(["dark", "light"] as const)("the chip's number on %s", (theme) => {
  const grounds = ["bg-surface", "bg-surface-raised", "bg-tile"].map((k) => neutrals[theme][k]!);
  // The tone and its wash in percent, as the CSS writes them: the accent's chip has a lighter wash, since its text reads 4.38:1 on the current tile at 18%.
  const tones: Array<[string, string, number]> = [
    ["warning", KIT_STATUS_TONES[theme].warning, 18],
    ["danger", KIT_STATUS_TONES[theme].danger, 18],
    ["accent (no severity)", accentText(theme), 12],
  ];

  it.each(tones)("reads %s at 4.5:1 on its wash", (_name, tone, pct) => {
    for (const ground of grounds) expect(contrastRatio(tone, wash(tone, ground, pct)), `on ${ground}`).toBeGreaterThanOrEqual(4.5);
  });

  it("writes those washes in the CSS", () => {
    expect(rule(CHIP)).toContain("color-mix(in srgb, var(--slc-accent) 12%, transparent)");
  });
});
