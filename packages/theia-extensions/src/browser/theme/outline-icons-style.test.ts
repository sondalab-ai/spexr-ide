import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { WORKBENCH } from "../shell/workbench-geometry.js";
import { accentText } from "./spexr-accent.js";
import { contrastRatio } from "./contrast-util.js";

const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
}

const NOT_HC = ':root:not([data-sl-theme="high-contrast"])';

describe("the outline icons in spexr.css (S6f)", () => {
  it("is Lumen's 14px glyph in the muted ink", () => {
    const glyph = rule(`${NOT_HC} .spexr-outline-icon`);
    expect(glyph).toMatch(/font-size:\s*14px/);
    expect(glyph).toMatch(/color:\s*var\(--slc-text-muted\)/);
  });

  it("takes the accent text on the selected row and on the current tab", () => {
    const sel = rule(`${NOT_HC} :is(.theia-TreeNode.theia-mod-selected, .lm-TabBar-tab.lm-mod-current) .spexr-outline-icon`);
    expect(sel).toMatch(/color:\s*var\(--slc-accent-text\)/);
  });

  it("swaps a folder's glyph for the opened one while its row is expanded", () => {
    const opened = rule(".theia-TreeNode:has(> .theia-ExpansionToggle:not(.theia-mod-collapsed)) .spexr-outline-icon--folder::before");
    expect(opened).toContain('content: "\\eaf7"');
  });

  it("is the table's 4px from the name", () => {
    const gap = rule("#theia-main-content-panel .lm-TabBar-tabIcon.spexr-outline-icon,\n.theia-TreeNode .file-icon.spexr-outline-icon");
    expect(gap).toContain(`margin-inline-end: ${WORKBENCH.treeIconGap}px`);
  });
});

type Theme = "dark" | "light";
const neutrals = kitNeutrals.products.spexr as unknown as Record<Theme, Record<string, string>>;

// The owner's rule: a glyph is a state indicator, at least 3:1 on its ground; the text is unchanged.
describe.each(["dark", "light"] as const)("the outline glyph's ink on %s", (theme) => {
  const n = (key: string): string => neutrals[theme][key]!;

  it("holds the muted glyph at 3:1 on the island's surface, the raised fill and a hovered row", () => {
    for (const ground of ["bg-surface", "bg-surface-raised"]) expect(contrastRatio(n("text-muted"), n(ground)), ground).toBeGreaterThanOrEqual(3);
  });

  it("holds the accent glyph at 3:1 on the selected row's tile, on the surface and on the raised fill", () => {
    for (const ground of ["bg-tile", "bg-surface", "bg-surface-raised"]) expect(contrastRatio(accentText(theme), n(ground)), ground).toBeGreaterThanOrEqual(3);
  });
});
