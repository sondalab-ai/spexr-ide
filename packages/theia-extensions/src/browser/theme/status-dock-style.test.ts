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

  it("keeps Theia's 22px row, each item a 20px pill inside it", () => {
    expect(dock).not.toContain("--theia-statusBar-height");
    expect(rule("#theia-statusBar {")).not.toMatch(/height/);
    expect(rule(`${ITEM} {`)).not.toMatch(/(^|[^-])height/);
    expect(rule(`${ITEM} {`)).toMatch(/margin-block:\s*1px/);
  });

  // Theia's spacing between two facts (its 6px gap and its text's 3px
  // margins) is the pills' 6px padding now: 12px either way.
  it("keeps Theia's 12px between two facts, as the pills' padding", () => {
    expect(rule(`${ITEM} {`)).toMatch(/padding-inline:\s*0\.375rem/);
    expect(rule(`${ITEM} > span:not(.codicon, .fa) {`)).toMatch(/margin-inline:\s*0/);
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

  // The offline bar is the kit's warning: the accent dot read 1.13:1 on it
  // and the hairlines 1.1, so both take the bar's label.
  it("draws the live dot and the hairlines in the offline bar's label", () => {
    expect(rule(`.theia-mod-offline ${ITEM}.${STATUS_LIVE}::after {`)).toMatch(/background-color:\s*currentColor/);
    expect(rule(`.theia-mod-offline ${ITEM} + .element::before {`)).toMatch(/border-left-color:\s*color-mix\(in srgb, currentColor 60%, transparent\)/);
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

  it("draws a hairline in the kit's border between groups, a border so forced colours keep it", () => {
    const sep = rule(`${ITEM} + .element::before {`);
    expect(sep).toMatch(/border-left:\s*1px solid var\(--slc-border\)/);
    expect(sep).toMatch(/pointer-events:\s*none/);
    // In the middle of the 9px margin between two pills, which touch otherwise.
    expect(rule("#theia-statusBar .area:is(.left, .right) {")).toMatch(/gap:\s*0/);
    expect(rule(`${ITEM} + .element {`)).toMatch(/margin-left:\s*0\.5625rem/);
    expect(sep).toMatch(/left:\s*-0\.3125rem/);
  });

  it("runs Theia's editor facts and its compacted entries together, with no hairline", () => {
    const together = `${ITEM}[id^="status-bar-editor-status-"] + .element[id^="status-bar-editor-status-"]`;
    expect(rule(`${together},`)).toMatch(/margin-left:\s*0/);
    expect(rule(`${together}::before,`)).toMatch(/content:\s*none/);
    // The editor's facts, as Theia names them in its own sources: every one
    // falls under the prefix the rule keys on.
    const editorIds = [
      ...[...theia("@theia/editor/src/browser/editor-contribution.ts").matchAll(/statusBar\.setElement\('([\w-]+)'/g)].map((m) => m[1]!),
      ...[...theia("@theia/monaco/src/browser/monaco-status-bar-contribution.ts").matchAll(/export const EDITOR_STATUS_\w+ = '([\w-]+)'/g)].map((m) => m[1]!),
      /LANGUAGE_MODE_ID = '([\w-]+)'/.exec(theia("@theia/editor/src/browser/language-status/editor-language-status-service.ts"))![1]!,
    ];
    expect([...editorIds].sort()).toEqual(["editor-status-cursor-position", "editor-status-encoding", "editor-status-eol", "editor-status-language", "editor-status-tabbing-config"]);
    for (const id of editorIds) expect(`status-bar-${id}`.startsWith("status-bar-editor-status-"), id).toBe(true);
    expect(dock).toContain(`${ITEM}.compact-left + .element::before`);
    expect(dock).toContain(`${ITEM} + .element.compact-right::before`);
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
