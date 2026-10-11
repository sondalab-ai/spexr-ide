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

  it("draws every directory as the one closed folder, as the demo does: no opened-folder swap", () => {
    expect(css).not.toContain(".spexr-outline-icon--folder::before");
    expect(css).not.toContain("folder-opened");
    expect(css).not.toContain("\\eaf7");
  });

  it("is the table's gap from the name, through one variable the tree and the tab read", () => {
    expect(css).toContain(`  --spexr-tree-icon-gap: ${WORKBENCH.treeIconGap}px;`);
    expect(rule(`${NOT_HC} .theia-TreeNode .file-icon.spexr-outline-icon`)).toContain("margin-inline-end: var(--spexr-tree-icon-gap)");
  });

  it("is a 14px box centred on its label in a tab, outranking Theia's 20px minimum height and 8px of padding", () => {
    const tab = rule(`${NOT_HC} :is(#theia-main-content-panel, #theia-bottom-content-panel) .lm-TabBar .lm-TabBar-tab .lm-TabBar-tabIcon.spexr-outline-icon`);
    expect(tab).toMatch(/width:\s*14px/);
    expect(tab).toMatch(/height:\s*14px/);
    expect(tab).toMatch(/min-height:\s*0/);
    expect(tab).toMatch(/padding:\s*0/);
    expect(tab).toContain("margin-inline-end: var(--spexr-tree-icon-gap)");
    // Theia's rule has the weight (0,4,0); an id in ours outranks it.
    const theia = readFileSync(fileURLToPath(new URL("../../../../../node_modules/@theia/core/src/browser/style/tabs.css", import.meta.url)), "utf8");
    expect(theia).toMatch(/\.lm-TabBar\[data-orientation="horizontal"\] \.lm-TabBar-tabIcon\.file-icon/);
    // Both the font-size and the box sit under the same high-contrast guard.
    expect(css.indexOf(`${NOT_HC} :is(#theia-main-content-panel, #theia-bottom-content-panel)`)).toBeGreaterThan(0);
  });
});

type Theme = "dark" | "light";
const neutrals = kitNeutrals.products.spexr as unknown as Record<Theme, Record<string, string>>;

// The owner's rule: a glyph is a state indicator, at least 3:1 on its ground; the text is unchanged.
describe.each(["dark", "light"] as const)("the outline glyph's ink on %s", (theme) => {
  const n = (key: string): string => neutrals[theme][key]!;

  it("holds the muted glyph at 3:1 on the island's surface and the raised fill", () => {
    for (const ground of ["bg-surface", "bg-surface-raised"]) expect(contrastRatio(n("text-muted"), n(ground)), ground).toBeGreaterThanOrEqual(3);
  });

  it("holds the accent glyph at 3:1 on the selected row's tile, on the surface and on the raised fill", () => {
    for (const ground of ["bg-tile", "bg-surface", "bg-surface-raised"]) expect(contrastRatio(accentText(theme), n(ground)), ground).toBeGreaterThanOrEqual(3);
  });
});
