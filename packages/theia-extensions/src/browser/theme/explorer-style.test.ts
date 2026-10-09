import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { WORKBENCH } from "../shell/workbench-geometry.js";

const resolve = createRequire(import.meta.url).resolve;
const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
const own = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const kitDir = dirname(resolve("@sondalab/ui-kit/effects.js"));

/** The declarations of the rule whose selector starts a line, as written. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
}

/** A length in a rule, as px (16px to the rem). */
function px(block: string, name: string): number {
  const m = new RegExp(`(?:^|[\\s;{])${name}:\\s*([\\d.]+)(px|rem)`).exec(block);
  expect(m, `${name} in ${block.slice(0, 120)}`).not.toBeNull();
  return Number(m![1]) * (m![2] === "rem" ? 16 : 1);
}

const LEFT = "#theia-left-content-panel";
const EXPLORER_HEAD = `${LEFT}:has(#explorer-view-container:not(.lm-mod-hidden)) .theia-sidepanel-toolbar`;

// spexr.css repeats the Explorer's measures from the geometry table
// (shell/workbench-geometry.ts): CSS cannot read it. These hold them together.
describe("the Explorer's section headers in spexr.css (S6b)", () => {
  const header = rule(`${LEFT} .theia-view-container-part-header`);

  it("are the table's 28px, in Theia's variable and in the layout's static", () => {
    // Scoped to the left island: the right and bottom keep Theia's 24px.
    const root = css.indexOf("\n#theia-left-content-panel {\n  --theia-view-container-title-height");
    expect(root, "the left island's rule for the section header's height").toBeGreaterThanOrEqual(0);
    expect(px(css.slice(root, css.indexOf("}", root)), "--theia-view-container-title-height")).toBe(WORKBENCH.sectionHead);
    expect(css).not.toMatch(/:root \{\s*--theia-view-container-title-height/);
    expect(header).toContain("height: var(--theia-view-container-title-height);");
    expect(own("../shell/section-header-height.ts")).toContain("HEADER_HEIGHT = WORKBENCH.sectionHead;");
    // Theia reads the static as a collapsed section's height, and the variable as the body's: both are the header's.
    const theia = readFileSync(resolve("@theia/core/lib/browser/view-container.js"), "utf8");
    expect(theia).toContain("headerSize: ViewContainerPart.HEADER_HEIGHT");
    expect(theia).toContain("ViewContainerPart.HEADER_HEIGHT = 22;");
    expect(readFileSync(resolve("@theia/core/src/browser/style/view-container.css"), "utf8")).toContain("--theia-view-container-content-height: calc(100% - var(--theia-view-container-title-height));");
    // The frontend module sets it before any container makes its layout.
    expect(own("../spexr-frontend-module.ts")).toMatch(/new ContainerModule\(\(bind, _unbind, isBound, rebind\) => \{[^\n]*\n[^\n]*\n\s*applySectionHeaderHeight\(\);/);
  });

  it("put the text 8px down on a 16px line, 4px above the foot, 16px in from the island's edge", () => {
    const padding = /padding:\s*(\d+)px calc\((\d+)px - var\(--spexr-island-ring\)\) (\d+)px;/.exec(header);
    expect(padding).not.toBeNull();
    expect(Number(padding![2])).toBe(WORKBENCH.sectionInset);
    expect(px(header, "line-height")).toBe(16);
    expect(Number(padding![1]) + px(header, "line-height") + Number(padding![3])).toBe(WORKBENCH.sectionHead);
  });

  it("speak the kit's micro register: mono, uppercase, --sl-text-micro at 500, +0.06em", () => {
    expect(header).toContain("font-family: var(--sl-font-mono);");
    expect(header).toContain("font-size: var(--sl-text-micro);");
    expect(header).toMatch(/font-weight:\s*500;/);
    expect(header).toContain("letter-spacing: 0.06em;");
    expect(header).toContain("text-transform: uppercase;");
    expect(kitFile("tokens.css")).toMatch(/--sl-text-micro:\s*0\.65625rem;/);
  });

  it("show the chevron on hover and focus, and always on a collapsed section", () => {
    const toggle = rule(`${LEFT} .theia-view-container-part-header .theia-ExpansionToggle`);
    expect(toggle).toMatch(/opacity:\s*0;/);
    expect(px(toggle, "width")).toBe(16);
    const shown = css.indexOf(`${LEFT} .theia-view-container-part-header:is(:hover, :focus-within) .theia-ExpansionToggle,`);
    expect(shown).toBeGreaterThan(0);
    expect(css.slice(shown, css.indexOf("}", shown))).toContain(`${LEFT} .part.collapsed .theia-view-container-part-header .theia-ExpansionToggle {`);
    expect(css.slice(shown, css.indexOf("}", shown))).toMatch(/opacity:\s*1;/);
  });

  it("keep the Explorer's only section's header, and hide the tools copy that header would show", () => {
    expect(rule("#explorer-view-container .theia-view-container-part-header")).toContain("display: flex !important;");
    expect(rule("#explorer-view-container .part > .body")).toContain("height: var(--theia-view-container-content-height) !important;");
    // Theia hides a lone section's title with an inline style, and folds its name into the container's title.
    const theia = readFileSync(resolve("@theia/core/lib/browser/view-container.js"), "utf8");
    expect(theia).toContain("this.header.style.display = 'none';");
    expect(theia).toContain("this.title.label += ': ' + partLabel;");
    expect(css).toContain("#explorer-view-container > .lm-SplitPanel:not(:has(> .part:not(.lm-mod-hidden) ~ .part:not(.lm-mod-hidden))) .theia-view-container-part-header .theia-view-container-part-title {");
  });
});

describe("the Explorer's head in spexr.css (S6b)", () => {
  const tools = rule(`${EXPLORER_HEAD} .lm-TabBar-toolbar`);
  const item = rule(`${EXPLORER_HEAD} .lm-TabBar-toolbar .item`);

  it("has the table's 24px tools, 8px in from the island's edge", () => {
    expect(px(item, "width")).toBe(WORKBENCH.paneTool);
    expect(px(item, "height")).toBe(WORKBENCH.paneTool);
    const inset = /padding-inline:\s*0 calc\((\d+)px - var\(--spexr-island-ring\)\);/.exec(tools);
    expect(inset).not.toBeNull();
    expect(Number(inset![1])).toBe(WORKBENCH.paneToolInset);
    expect(item).toContain("border-radius: var(--sl-radius-md);");
  });

  it("shows a plus for New File, and brings New Folder, Refresh and Collapse All out only while the head is hovered or has focus", () => {
    expect(rule(`${EXPLORER_HEAD} .lm-TabBar-toolbar .codicon-new-file::before`)).toContain('content: "\\ea60";');
    expect(readFileSync(resolve("@vscode/codicons/dist/codicon.css"), "utf8")).toContain('.codicon-add:before { content: "\\ea60" }');
    const hidden = rule(`${EXPLORER_HEAD}:not(:hover, :focus-within) .lm-TabBar-toolbar .item:has(> :is(.codicon-new-folder, .codicon-refresh, .codicon-collapse-all))`);
    // They keep their place: opacity and visibility, never display, so the plus and the dots stay put.
    expect(hidden).toMatch(/opacity:\s*0;/);
    expect(hidden).toContain("visibility: hidden;");
    expect(hidden).not.toContain("display");
    // Reached by the keyboard, a tool or a section header takes the kit's flush ring.
    const ring = css.indexOf(`${LEFT} :is(.theia-sidepanel-toolbar .lm-TabBar-toolbar .item > div, .theia-view-container-part-header):focus-visible {`);
    expect(ring).toBeGreaterThan(0);
    expect(css.slice(ring, css.indexOf("}", ring))).toContain("outline-offset: calc(-1 * var(--sl-focus-ring-width));");
    // Theia's four tools, by the icons they are given, and "..." as the rest.
    const commands = readFileSync(resolve("@theia/navigator/lib/browser/file-navigator-commands.js"), "utf8");
    for (const icon of ["new-file", "new-folder", "refresh", "collapse-all"]) expect(commands).toContain(`(0, browser_1.codicon)('${icon}')`);
    expect(readFileSync(resolve("@theia/core/lib/browser/shell/tab-bar-toolbar/tab-bar-toolbar.js"), "utf8")).toContain("(0, widgets_1.codicon)('ellipsis', true)");
  });
});

describe("the Explorer's git letters in spexr.css (S6b, L7)", () => {
  const tail = rule(`${LEFT} .theia-FileTree .theia-TreeNodeTail`);

  it("are the table's 12px mono at 600, right-aligned", () => {
    expect(px(tail, "font-size")).toBe(WORKBENCH.gitLetter);
    expect(tail).toContain("font-family: var(--sl-font-mono);");
    expect(tail).toMatch(/font-weight:\s*600;/);
    expect(tail).toContain("justify-content: flex-end;");
  });

  it("end 16px in from the island's edge", () => {
    const row = rule(`${LEFT} .theia-FileTree .theia-TreeNodeContent`);
    const inset = /padding-right:\s*calc\((\d+)px - var\(--spexr-island-ring\)\);/.exec(row);
    expect(inset).not.toBeNull();
    expect(Number(inset![1])).toBe(WORKBENCH.sectionInset);
  });

  it("take git's status tones, which the chrome layer binds: modified is the warning tone, untracked the success tone", () => {
    const chrome = own("./theia-chrome-css.ts");
    expect(chrome).toContain("--theia-gitDecoration-modifiedResourceForeground: var(--sl-status-warning) !important;");
    expect(chrome).toContain("--theia-gitDecoration-untrackedResourceForeground: var(--sl-status-success) !important;");
  });
});

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (c: Rgb): number => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
const contrast = (a: Rgb, b: Rgb): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
/** `over` painted at `alpha` on `ground`, as sRGB channels (what `color-mix(in srgb, over alpha, transparent)` gives on it). */
const blend = (over: Rgb, ground: Rgb, alpha: number): Rgb => over.map((c, i) => c * alpha + ground[i]! * (1 - alpha)) as Rgb;
function kitFile(name: string): string {
  return readFileSync(join(kitDir, name), "utf8");
}

describe.each(["light", "dark"] as const)("the Explorer's git letters on %s", (theme) => {
  const neutrals = kitNeutrals.products.spexr[theme];
  const tone = (name: string): Rgb => hex(new RegExp(`--sl-status-${name}:\\s*(#[0-9a-f]{6})`).exec(kitFile(`themes/${theme}.css`))![1]!);
  const surface = hex(neutrals["bg-surface"]);
  const grounds: Record<string, Rgb> = {
    "the island": surface,
    "a selected row's tile": hex(neutrals["bg-tile"]),
    "a hovered row (5% of the ink)": blend(hex(neutrals["text-primary"]), surface, 0.05),
  };

  it.each(Object.entries(grounds))("read at 4.5:1 or more as M (modified) and U (untracked) on %s", (_where, ground) => {
    expect(contrast(tone("warning"), ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tone("success"), ground)).toBeGreaterThanOrEqual(4.5);
  });
});
