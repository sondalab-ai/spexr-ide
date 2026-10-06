import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STATUS_DATA, STATUS_LIVE } from "../shell/status-dock.js";

const resolve = createRequire(import.meta.url).resolve;
const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
const theia = (file: string): string => readFileSync(resolve(file), "utf8");

/** The declarations of the rule whose selector list starts with `selector` (on a line of its own). */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector}`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
}

/** The status dock's section of spexr.css, comments stripped. */
const dock = (() => {
  const start = css.indexOf("/* ══ THE STATUS DOCK");
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("/* ══ TOASTS AND THE NOTIFICATION CENTER", start)).replace(/\/\*[\s\S]*?\*\//g, "");
})();

const ITEM = "#theia-statusBar .area:is(.left, .right) > .element";

// Theia renders an entry as `<div id="status-bar-<entry id>" class="element">`
// with a span per run of text and per glyph; the dock reaches Theia's own
// entries by those ids and spexr's by their className.
describe("the status dock's hooks", () => {
  it("are the ids Theia gives its entries", () => {
    expect(theia("@theia/core/src/browser/status-bar/status-bar.tsx")).toContain("attrs.id = 'status-bar-' + viewEntry.id;");
    const editor = theia("@theia/editor/src/browser/editor-contribution.ts");
    expect(editor).toContain("statusBar.setElement('editor-status-cursor-position'");
    expect(editor).toContain("statusBar.setElement('editor-status-encoding'");
    expect(theia("@theia/monaco/src/browser/monaco-status-bar-contribution.ts")).toContain("EDITOR_STATUS_EOL = 'editor-status-eol'");
    expect(theia("@theia/markers/src/browser/problem/problem-contribution.ts")).toContain("this.statusBar.setElement('problem-marker-status'");
    expect(theia("@theia/messages/src/browser/notifications-contribution.ts")).toContain("protected readonly id = 'theia-notification-center';");
  });

  it("read spexr's own class hooks", () => {
    expect(dock).toContain(`.${STATUS_DATA}`);
    expect(dock).toContain(`.${STATUS_LIVE}`);
  });
});

describe("the status dock", () => {
  it("sets its facts in the kit's sans at the small step, as written", () => {
    expect(rule("#theia-statusBar {")).toMatch(/font-family:\s*var\(--sl-font-sans\)/);
    expect(rule("#theia-statusBar {")).toMatch(/font-size:\s*var\(--sl-text-xs\)/);
    const item = rule(`${ITEM} {`);
    expect(item).toMatch(/font-family:\s*var\(--sl-font-sans\)/);
    expect(item).toMatch(/border-radius:\s*var\(--sl-radius-sm\)/);
    expect(dock).not.toMatch(/text-transform/);
  });

  // S5c: the kit's 28px bar (Lumen's 30 on the grid), each item its 20px
  // pill centred in it, through the variable only Theia's bar reads.
  it("is the kit's 28px bar, each item a 20px pill centred in it", () => {
    expect(rule(":root {\n  --theia-statusBar-height")).toMatch(/--theia-statusBar-height:\s*28px;/);
    const bar = theia("@theia/core/src/browser/style/status-bar.css");
    expect(bar).toMatch(/#theia-statusBar \{[^}]*min-height:\s*var\(--theia-statusBar-height\)/);
    expect(rule("#theia-statusBar {")).not.toMatch(/height/);
    const item = rule(`${ITEM} {`);
    expect(item).toMatch(/height:\s*1\.25rem/);
    expect(item).toMatch(/align-self:\s*center/);
    expect(item).toMatch(/margin-block:\s*0/);
  });

  // Lumen's and the kit's spacing: 8px into each pill, the pills side by side
  // (Theia's gap and its text's margins go), 4px into the bar at its start
  // and 8 at its end.
  it("sets the pills side by side, 8px in, 4 and 8px from the bar's ends", () => {
    expect(rule(`${ITEM} {`)).toMatch(/padding-inline:\s*0\.5rem/);
    expect(rule("#theia-statusBar .area:is(.left, .right) {")).toMatch(/gap:\s*0/);
    expect(rule(`${ITEM} > span:not(.codicon, .fa) {`)).toMatch(/margin-inline:\s*0/);
    expect(rule("#theia-statusBar.lm-Widget .area.left {")).toMatch(/padding-left:\s*4px/);
    expect(rule("#theia-statusBar.lm-Widget .area.right {")).toMatch(/padding-right:\s*8px/);
    const bar = theia("@theia/core/src/browser/style/status-bar.css");
    expect(bar).toMatch(/gap:\s*var\(--theia-ui-padding\)/);
    expect(bar).toMatch(/margin-inline:\s*calc\(var\(--theia-ui-padding\) \/ 2\)/);
  });

  // Theia's areas each take half the bar (a zero basis); the dock's start
  // from their content, so a busy half borrows from a quiet one.
  it("ends a fact that does not fit in an ellipsis, on its text, not its glyphs", () => {
    expect(rule("#theia-statusBar .area:is(.left, .right) {")).toMatch(/flex:\s*1 1 auto/);
    expect(rule("#theia-statusBar .area:is(.left, .right) {")).toMatch(/min-width:\s*0/);
    const text = rule(`${ITEM} > span:not(.codicon, .fa) {`);
    expect(text).toMatch(/min-width:\s*0/);
    expect(text).toMatch(/overflow:\s*hidden/);
    expect(text).toMatch(/text-overflow:\s*ellipsis/);
    // An ellipsis inside "0 errors 2 warnings" says nothing: an entry of
    // several runs keeps its width.
    expect(rule(`${ITEM}:has(> span:not(.codicon, .fa) ~ span:not(.codicon, .fa)),`)).toMatch(/flex-shrink:\s*0/);
    // A live state's progress ends its words: it keeps its width too.
    expect(css).toContain(`${ITEM}:has(> span:not(.codicon, .fa) ~ span:not(.codicon, .fa)),\n${ITEM}.${STATUS_LIVE} {`);
  });

  // The offline bar is the kit's warning: the accent dot read 1.13:1 on it,
  // so it takes the bar's label.
  it("draws the live dot in the offline bar's label", () => {
    expect(rule(`.theia-mod-offline ${ITEM}.${STATUS_LIVE}::after {`)).toMatch(/background-color:\s*currentColor/);
  });

  it("sets data in the mono at the primary ink, never on the offline bar or a ground of its own", () => {
    const start = css.indexOf("\nbody:not(.theia-mod-offline) #theia-statusBar");
    expect(start).toBeGreaterThanOrEqual(0);
    const selector = css.slice(start, css.indexOf("{", start));
    for (const id of ["editor-status-cursor-position", "editor-status-encoding", "editor-status-eol", "problem-marker-status"]) {
      expect(selector, id).toContain(`#status-bar-${id}`);
    }
    // The title bar's bell replaced the notification item (S5b-1).
    expect(selector).not.toContain("#status-bar-theia-notification-center");
    expect(selector).toContain(`.${STATUS_DATA}`);
    expect(selector).toContain(":not(.has-background) > span:not(.codicon, .fa)");
    const data = css.slice(css.indexOf("{", start), css.indexOf("}", start));
    expect(data).toMatch(/font-family:\s*var\(--sl-font-mono\)/);
    expect(data).toMatch(/font-weight:\s*500/);
    expect(data).toMatch(/color:\s*var\(--slc-text\)/);
  });

  // Lumen draws no hairlines, and the kit's are opt-in since 0.34 (S5c).
  it("draws no hairline between items, and pulls no item into a gap", () => {
    expect(dock).not.toMatch(/\.element \+ \.element::before/);
    expect(dock).not.toMatch(/border-left:/);
    expect(dock).not.toMatch(/margin-left:\s*0\.5625rem/);
    // Theia pulls a left item with a ground, and a compacted entry, 6px left into its old gap.
    const reset = rule("#theia-statusBar.lm-Widget .area:is(.left, .right) > .element.has-background:not(#session-preference-status),");
    expect(reset).toMatch(/margin-left:\s*0/);
    expect(css).toContain(`#theia-statusBar.lm-Widget .area:is(.left, .right) > .element.has-background:not(#session-preference-status),\n${ITEM} + .element.compact-right {`);
    expect(theia("@theia/core/src/browser/style/status-bar.css")).toMatch(/\.element\.compact-right \{\s*margin-left: calc\(-1 \* var\(--theia-ui-padding\)\);/);
  });

  it("marks a live state with a 6px dot of the accent before its words, in CanvasText under forced colours", () => {
    const dot = rule(`${ITEM}.${STATUS_LIVE}::after {`);
    expect(dot).toMatch(/order:\s*-1/);
    expect(dot).toMatch(/width:\s*6px/);
    expect(dot).toMatch(/height:\s*6px/);
    expect(dot).toMatch(/border-radius:\s*50%/);
    expect(dot).toMatch(/background-color:\s*var\(--slc-accent-text\)/);
    expect(dock).toMatch(/@media \(forced-colors: active\)\s*\{\s*#theia-statusBar[^{]*spexr-status--live::after\s*\{[^}]*background-color:\s*CanvasText/);
  });

  it("never sets the accent anywhere but the live dot", () => {
    expect(dock.match(/--slc-(accent|seam)[\w-]*/g)).toEqual(["--slc-accent-text"]);
  });
});
