import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { WORKBENCH } from "../shell/workbench-geometry.js";
import { ACCENT_FILL, KIT_STATUS_TONES, labelOn } from "./spexr-accent.js";
import { contrastRatio } from "./contrast-util.js";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const css = read("../style/spexr.css");

/** The declarations of the first rule whose selector contains `selector`. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
}

function px(block: string, name: string): number {
  const m = new RegExp(`(?:^|[\\s;{])${name}:\\s*([\\d.]+)(px|rem)`).exec(block);
  expect(m, `${name} in ${block.slice(0, 120)}`).not.toBeNull();
  return Number(m![1]) * (m![2] === "rem" ? 16 : 1);
}

describe("the activity bar and the status bar in spexr.css (S6d)", () => {
  it("is the table's count badge: 16px high, 20px wide at least, r6", () => {
    const badge = rule(':root:not([data-sl-theme="high-contrast"]) .lm-TabBar.theia-app-sides .theia-badge-decorator-sidebar');
    expect(px(badge, "height")).toBe(WORKBENCH.activityBadge);
    expect(px(badge, "min-width")).toBe(WORKBENCH.activityBadgeMinWidth);
    expect(px(badge, "border-radius")).toBe(6);
  });

  it("is the table's status item: 8px in at each side", () => {
    expect(px(rule("#theia-statusBar .area:is(.left, .right) > .element"), "padding-inline")).toBe(WORKBENCH.statusItemPadding);
  });

  it("takes the title bar's crumb root as the project switch: a no-drag button", () => {
    const root = rule(".spexr-titlebar-host .spexr-titlebar__root");
    expect(root).toMatch(/app-region:\s*no-drag/);
    expect(read("../commands/spexr-commands-contribution.ts")).toContain('SWITCH_PROJECT: { id: "spexr.project.switch"');
  });
});

type Theme = "dark" | "light";
const neutrals = kitNeutrals.products.spexr as unknown as Record<Theme, Record<string, string>>;

// The owner's rules: text at least 4.5:1, a boundary or a state indicator at least 3:1.
describe.each(["dark", "light"] as const)("the activity and status bars' inks on %s", (theme) => {
  const n = (key: string): string => neutrals[theme][key]!;
  // The status bar sits on the canvas, below the islands.
  const ground = (): string => n("bg-canvas");

  it("reads the bar's muted words and the mono values at 4.5:1 on the canvas", () => {
    expect(contrastRatio(n("text-muted"), ground()), "muted").toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(n("text-primary"), ground()), "value").toBeGreaterThanOrEqual(4.5);
  });

  it("holds the warning glyph, a state indicator, at 3:1 on the canvas", () => {
    expect(contrastRatio(KIT_STATUS_TONES[theme].warning, ground())).toBeGreaterThanOrEqual(3);
  });

  it("reads the count badge's digits at 4.5:1 on its accent fill", () => {
    const fill = ACCENT_FILL[theme];
    expect(contrastRatio(labelOn(fill), fill)).toBeGreaterThanOrEqual(4.5);
  });
});
