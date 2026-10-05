#!/usr/bin/env node
// @ts-check

/**
 * Measure the Lumen IDE demo as it renders, to freeze the reference the
 * parity slices compare spexr against. Local only, and never in CI: the demo
 * lives in the private sondalab-ui repository, and the owner's call is that
 * spexr keeps this frozen copy and evolves on its own afterwards.
 *
 * Serves a sondalab-ui checkout over http on 127.0.0.1 (fonts do not load
 * from file://), opens `showcase/screens-stage.html?screen=ide&dir=lumen&
 * accent=indigo&theme=<theme>` at exactly 1440×900 in headless Chrome, waits
 * for the Lumen overlay and the fonts, finishes the finite animations and
 * pauses the infinite ones at t=0, then writes to `--out`:
 *   demo-<theme>.png      the screen, 1440×900 at device scale 1
 *   demo-base-<theme>.png the same without the palette and the toast, for the base scene
 *   demo-regions.json     per named region: rect, type, radius, colours, shadows
 *   catalogue-check.md    where the measurement disagrees with the computed catalogue
 *
 * Usage: node measure-demo.mjs --kit <sondalab-ui checkout> [--out <dir>] [--port <n>]
 * The port defaults to the first free one in 8788–8799.
 */

import { chromium } from "@playwright/test";
import { execFileSync } from "child_process";
import fs from "fs";
import http from "http";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THEMES = /** @type {const} */ (["dark", "light"]);
const VIEWPORT = { width: 1440, height: 900 };
const STAGE = "showcase/screens-stage.html";
const QUERY = (theme) => `screen=ide&dir=lumen&accent=indigo&theme=${theme}`;
const PORTS = { from: 8788, to: 8799 };
/** Taken on this machine (Okta Verify) or by other local previews. */
const NEVER = new Set([8769, 8780]);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/** Cap on items recorded for a region that matches many elements. */
const MAX_ITEMS = 16;

// ── regions ──────────────────────────────────────────────────────────────
// [name, selector, options]. `all` records every match (up to MAX_ITEMS);
// `pseudo` also records those pseudo-elements' computed boxes and paint.
/** @type {Array<[string, string, { all?: boolean; pseudo?: string[] }?]>} */
const REGIONS = [
  ["app", ".app.ide"],
  ["body", ".app__body"],

  ["title", "header.ide-title"],
  ["title.left", ".ide-title__l"],
  ["title.dots", ".ide-dots"],
  ["title.dot", ".ide-dots i"],
  ["title.mark", ".ide-mark", { pseudo: ["::after"] }],
  ["title.crumb", ".ide-title__crumb"],
  ["title.crumb.sep", ".ide-title__crumb span"],
  ["title.cmd", ".ide-cmd"],
  ["title.cmd.icon", ".ide-cmd > svg"],
  ["title.cmd.text", ".ide-cmd > span:not(.ide-keys)"],
  ["title.cmd.keys", ".ide-cmd .ide-keys"],
  ["title.cmd.kbd", ".ide-cmd .sl-kbd", { all: true }],
  ["title.right", ".ide-title__r"],
  ["title.agents", ".ide-live", { pseudo: ["::before"] }],
  ["title.split", '.ide-title__r .sl-icon-btn[aria-label="Toggle split"]'],
  ["title.bell", ".ide-title__r .sl-icon-btn[data-count]", { pseudo: ["::after"] }],
  ["title.avatar", ".ide-avatar"],

  ["activity", "nav.ide-activity"],
  ["activity.item", ".ide-activity__btn", { all: true }],
  ["activity.current", ".ide-activity__btn[aria-current]"],
  ["activity.current.icon", ".ide-activity__btn[aria-current] svg"],
  ["activity.icon", ".ide-activity__btn:not([aria-current]) svg"],
  ["activity.count", ".ide-activity__btn[data-count]", { pseudo: ["::after"] }],

  ["left", "aside.ide-side"],
  ["left.head", ".ide-side .pane__head"],
  ["left.label", ".ide-side .pane__label"],
  ["left.tool", ".ide-side .pane__tools .sl-icon-btn", { all: true }],
  ["left.sub", ".ide-side .pane__sub", { all: true }],
  ["tree", ".ide-tree"],
  ["tree.row", ".ide-tree__row", { all: true }],
  ["tree.sel", ".ide-tree__row.is-sel"],
  ["tree.twisty", ".ide-tree__row[aria-expanded] .ide-tree__tw"],
  ["tree.twisty.svg", ".ide-tree__row[aria-expanded] .ide-tree__tw svg"],
  ["tree.icon", ".ide-tree__row:not(.is-sel) .ide-tree__ic"],
  ["tree.icon.sel", ".ide-tree__row.is-sel .ide-tree__ic"],
  ["tree.name", ".ide-tree__row:not(.is-sel) .ide-tree__name"],
  ["tree.name.sel", ".ide-tree__row.is-sel .ide-tree__name"],
  ["tree.git", ".ide-tree__git", { all: true }],
  ["sessions", ".ide-sessions"],
  ["sessions.row", ".ide-sessions .sl-list__row", { all: true }],
  ["sessions.sel", '.ide-sessions .sl-list__row[aria-selected="true"]'],
  ["sessions.meta", '.ide-sessions .sl-list__row[aria-selected="false"]:not(.lab-hover) .sl-list__meta'],

  ["main", "main.ide-main"],
  ["tabs", ".ide-main > .ide-tabs", { pseudo: ["::before", "::after"] }],
  ["tab", ".ide-tab", { all: true }],
  ["tab.active", '.ide-tab[aria-selected="true"]'],
  ["tab.active.icon", '.ide-tab[aria-selected="true"] svg'],
  ["tab.active.label", '.ide-tab[aria-selected="true"] > span:not(.sr)'],
  ["tab.label", '.ide-tab[aria-selected="false"] > span:not(.sr)'],
  ["tab.dot.active", '.ide-tab[aria-selected="true"] .ide-tab__dot'],
  ["tab.dot", '.ide-tab[aria-selected="false"] .ide-tab__dot'],
  ["tabs.split", ".ide-tabs .sl-icon-btn"],
  ["crumbs", ".ide-crumbs"],
  ["crumbs.item", ".ide-crumbs > span:not(.ide-crumbs__sp):not(.ide-crumbs__meta)", { all: true }],
  ["crumbs.current", ".ide-crumbs b"],
  ["crumbs.chevron", ".ide-crumbs > svg"],
  ["crumbs.meta", ".ide-crumbs__meta"],
  ["code", ".ide-code"],
  ["code.line", ".ide-code__ln", { all: true }],
  ["code.line.cur", ".ide-code__ln.is-cur"],
  ["code.line.sel", ".ide-code__ln.is-sel"],
  ["code.no", ".ide-code__ln:not(.is-cur) .ide-code__no"],
  ["code.no.cur", ".ide-code__ln.is-cur .ide-code__no"],
  ["code.tx", ".ide-code__ln:not(.is-sel) .ide-code__tx"],
  ["code.tx.sel", ".ide-code__ln.is-sel .ide-code__tx"],
  ["code.squiggle", ".ide-squiggle"],
  ["code.diag", ".ide-diag"],
  ["syntax.keyword", ".ide-code .tk-k"],
  ["syntax.string", ".ide-code .tk-s"],
  ["syntax.function", ".ide-code .tk-f"],
  ["syntax.comment", ".ide-code .tk-c"],
  ["syntax.number", ".ide-code .tk-n"],
  ["syntax.type", ".ide-code .tk-t"],
  ["syntax.variable", ".ide-code .tk-v"],

  ["panel", "section.ide-panel"],
  ["panel.tabs", ".ide-panel__tabs"],
  ["ptab", ".ide-ptab", { all: true }],
  ["ptab.active", '.ide-ptab[aria-selected="true"]'],
  ["ptab.count", ".ide-ptab__n"],
  ["panel.button", ".ide-panel__tabs .sl-icon-btn", { all: true }],
  ["term", ".ide-term"],
  ["term.block", ".ide-block", { all: true, pseudo: ["::before"] }],
  ["term.block.head", ".ide-block__head"],
  ["term.cmd", ".ide-block__cmd"],
  ["term.meta", ".ide-block__meta"],
  ["term.exit", ".ide-block__exit", { all: true }],
  ["term.out", ".ide-block__out"],
  ["term.prompt", ".ide-prompt"],
  ["term.caret", ".ide-caret"],

  ["agent", "aside.ide-agent"],
  ["agent.head", ".ide-agent__head"],
  ["agent.eyebrow", ".ide-agent__eb"],
  ["agent.title", ".ide-agent__title"],
  ["agent.model", ".ide-agent__model", { pseudo: ["::before"] }],
  ["agent.log", ".ide-agent__log"],
  ["agent.msg.user", ".ide-msg--user"],
  ["agent.msg", ".ide-msg:not(.ide-msg--user) > p"],
  ["agent.code", ".ide-msg .sl-code"],
  ["agent.tools", "ol.ide-tools"],
  ["agent.tool", ".ide-tool", { all: true }],
  ["agent.tool.run", '.ide-tool[data-state="run"]'],
  ["agent.tool.name", ".ide-tool b"],
  ["agent.tool.meta", ".ide-tool__m"],
  ["agent.diffcard", ".ide-diffcard"],
  ["agent.plan", ".ide-plan"],
  ["agent.check.box", ".ide-plan .sl-check__box", { all: true }],
  ["agent.check.label", ".ide-plan .sl-check__label"],
  ["agent.composer", ".ide-composer"],
  ["agent.textarea", ".ide-composer textarea"],
  ["agent.chip", ".ide-composer .sl-chip", { pseudo: ["::before"] }],
  ["agent.plan.button", ".ide-composer .sl-btn--ghost"],
  ["agent.send", ".ide-composer .sl-btn--primary", { pseudo: ["::after"] }],

  ["status", "footer.ide-status"],
  ["status.item", ".ide-status__item", { all: true }],
  ["status.branch", ".ide-status__branch"],
  ["status.value", ".ide-status .sl-statusbar__value"],
  ["status.diag", ".ide-status__diag"],
  ["status.agents", ".ide-status__agents"],
  ["status.dot", ".ide-pulse"],

  ["palette.scrim", ".ide-scrim"],
  ["palette", ".ide-pal", { pseudo: ["::before"] }],
  ["palette.head", ".ide-pal__in"],
  ["palette.icon", ".ide-pal__in > svg"],
  ["palette.input", ".ide-pal__input"],
  ["palette.scope", ".ide-pal__scope"],
  ["palette.list", ".ide-pal__list"],
  ["palette.group", ".ide-pal__grp", { all: true }],
  ["palette.row", ".ide-pal__row", { all: true }],
  ["palette.row.sel", '.ide-pal__row[aria-selected="true"]'],
  ["palette.row.sel.icon", '.ide-pal__row[aria-selected="true"] > svg'],
  ["palette.row.icon", '.ide-pal__row[aria-selected="false"] > svg'],
  ["palette.label", '.ide-pal__row[aria-selected="false"] .ide-pal__t'],
  ["palette.mark", '.ide-pal__row[aria-selected="false"] .ide-pal__t mark'],
  ["palette.meta", '.ide-pal__row[aria-selected="false"] .ide-pal__m'],
  ["palette.keys", ".ide-pal__row .ide-keys"],
  ["palette.kbd", ".ide-pal__row .sl-kbd"],
  ["palette.foot", ".ide-pal__foot"],

  ["toasts", ".ide-toasts"],
  ["toast", ".ide-toast:not(.ide-toast--back)", { pseudo: ["::before"] }],
  ["toast.back", ".ide-toast--back"],
  ["toast.mark", ".ide-toast__mark"],
  ["toast.title", ".ide-toast__title"],
  ["toast.body", ".ide-toast__body"],
  ["toast.undo", ".ide-toast__undo", { pseudo: ["::after"] }],
  ["toast.dismiss", ".ide-toast__x"],
  ["toast.timer", ".ide-toast__timer"],
  ["toast.timer.bar", ".ide-toast__timer .sl-progress__bar"],
];

// ── catalogue checks ─────────────────────────────────────────────────────
// The computed catalogue's numbers, with its own tags: [lit] a literal in the
// CSS, [arith] its layout arithmetic, [spec] a specificity reading. Sources
// are the catalogue's (L = dir-lumen.css, S = screens.css, C = components.css,
// W = workbench.css, J = screens.js). `get` reads a region's first item
// unless an index is given; `expect` may differ per theme.
const px = (v) => (v == null ? null : Math.round(parseFloat(v) * 100) / 100);
/** @typedef {{ id: string; get: (q: Query) => unknown; expect: unknown; tol?: number; tag: string; src: string }} Check */
/** @typedef {(region: string, index?: number) => any} Query */
/** @type {Check[]} */
const CHECKS = [
  // shell
  { id: "title bar height", get: (q) => q("title").rect.h, expect: 44, tag: "lit", src: "L:70" },
  { id: "status bar y", get: (q) => q("status").rect.y, expect: 870, tag: "arith", src: "§1" },
  { id: "status bar height", get: (q) => q("status").rect.h, expect: 30, tag: "lit", src: "L:70" },
  { id: "activity bar x", get: (q) => q("activity").rect.x, expect: 0, tag: "arith", src: "§1" },
  { id: "activity bar width", get: (q) => q("activity").rect.w, expect: 52, tag: "lit", src: "L:116" },
  { id: "Explorer x", get: (q) => q("left").rect.x, expect: 58, tag: "arith", src: "§1" },
  { id: "Explorer width", get: (q) => q("left").rect.w, expect: 264, tag: "lit", src: "S:104" },
  { id: "Explorer y", get: (q) => q("left").rect.y, expect: 44, tag: "arith", src: "§1" },
  { id: "Explorer height", get: (q) => q("left").rect.h, expect: 826, tag: "arith", src: "§1" },
  { id: "editor x", get: (q) => q("main").rect.x, expect: 328, tag: "arith", src: "§1" },
  { id: "editor width", get: (q) => q("main").rect.w, expect: 748, tag: "arith", src: "§1" },
  { id: "agent pane x", get: (q) => q("agent").rect.x, expect: 1082, tag: "arith", src: "§1" },
  { id: "agent pane width", get: (q) => q("agent").rect.w, expect: 352, tag: "lit", src: "L:202" },
  { id: "agent pane right edge", get: (q) => q("agent").rect.x + q("agent").rect.w, expect: 1434, tag: "arith", src: "§1" },
  { id: "tab strip y", get: (q) => q("tabs").rect.y, expect: 44, tag: "arith", src: "§1" },
  { id: "tab strip height", get: (q) => q("tabs").rect.h, expect: 38, tag: "lit", src: "L:73" },
  { id: "crumbs y", get: (q) => q("crumbs").rect.y, expect: 82, tag: "arith", src: "§1" },
  { id: "crumbs height", get: (q) => q("crumbs").rect.h, expect: 30, tag: "lit", src: "L:73" },
  { id: "code y", get: (q) => q("code").rect.y, expect: 112, tag: "arith", src: "§1" },
  { id: "code height", get: (q) => q("code").rect.h, expect: 548, tag: "arith", src: "§1" },
  { id: "panel y", get: (q) => q("panel").rect.y, expect: 666, tag: "arith", src: "§1" },
  { id: "panel height", get: (q) => q("panel").rect.h, expect: 204, tag: "arith", src: "§1" },

  // title bar
  { id: "title bar padding", get: (q) => q("title").style.padding, expect: "0px 9.6px 0px 14.4px", tag: "lit", src: "L:109" },
  { id: "command field x", get: (q) => q("title.cmd").rect.x, expect: 466.4, tag: "arith", src: "§2.1" },
  { id: "command field width", get: (q) => q("title.cmd").rect.w, expect: 512, tag: "arith", src: "§2.1" },
  { id: "command field height", get: (q) => q("title.cmd").rect.h, expect: 30, tag: "lit", src: "L:113" },
  { id: "command field radius", get: (q) => q("title.cmd").style.borderRadius, expect: "8px", tag: "lit", src: "L:113" },
  { id: "command field font size", get: (q) => q("title.cmd").style.fontSize, expect: "13px", tag: "lit", src: "L:113" },
  { id: "wordmark weight", get: (q) => q("title.mark").style.fontWeight, expect: "700", tag: "lit", src: "L:110" },
  { id: "wordmark size", get: (q) => q("title.mark").style.fontSize, expect: "15px", tag: "lit", src: "L:110" },
  { id: "wordmark tracking", get: (q) => q("title.mark").style.letterSpacing, expect: "-0.6px", tag: "lit", src: "L:110" },
  { id: "wordmark dot size", get: (q) => `${q("title.mark").pseudo["::after"].width} × ${q("title.mark").pseudo["::after"].height}`, expect: "5px × 5px", tag: "lit", src: "L:111" },
  { id: "traffic dot size", get: (q) => `${q("title.dot").rect.w} × ${q("title.dot").rect.h}`, expect: "11 × 11", tag: "lit", src: "S:86" },
  { id: "agents pill height", get: (q) => q("title.agents").rect.h, expect: 20.4, tag: "arith", src: "§2.1" },
  { id: "agents pill radius", get: (q) => q("title.agents").style.borderRadius, expect: "6px", tag: "lit", src: "L:282" },
  { id: "agents pill padding", get: (q) => q("title.agents").style.padding, expect: "3.2px 8px 3.2px 7.2px", tag: "lit", src: "L:115" },
  { id: "agents pill type", get: (q) => `${q("title.agents").style.fontSize} ${q("title.agents").style.fontWeight}`, expect: "12px 500", tag: "lit", src: "L:115" },
  { id: "title icon button size", get: (q) => `${q("title.bell").rect.w} × ${q("title.bell").rect.h}`, expect: "32 × 32", tag: "lit", src: "C:1951" },
  { id: "title icon button radius", get: (q) => q("title.bell").style.borderRadius, expect: "8px", tag: "lit", src: "C:1951" },
  { id: "bell dot size", get: (q) => `${q("title.bell").pseudo["::after"].width} × ${q("title.bell").pseudo["::after"].height}`, expect: "6px × 6px", tag: "lit", src: "L:278" },
  { id: "avatar size", get: (q) => `${q("title.avatar").rect.w} × ${q("title.avatar").rect.h}`, expect: "26 × 26", tag: "lit", src: "S:94" },
  { id: "avatar radius", get: (q) => q("title.avatar").style.borderRadius, expect: "8px", tag: "lit", src: "L:284" },
  { id: "avatar type", get: (q) => `${q("title.avatar").style.fontSize} ${q("title.avatar").style.fontWeight}`, expect: "10px 600", tag: "lit", src: "S:94" },

  // activity bar
  { id: "activity item size", get: (q) => `${q("activity.item").rect.w} × ${q("activity.item").rect.h}`, expect: "38 × 38", tag: "lit", src: "L:117" },
  { id: "activity item radius", get: (q) => q("activity.item").style.borderRadius, expect: "9px", tag: "lit", src: "L:117" },
  { id: "activity item x", get: (q) => q("activity.item").rect.x, expect: 7, tag: "arith", src: "§2.2" },
  { id: "activity item 1 y", get: (q) => q("activity.item", 0).rect.y, expect: 48, tag: "arith", src: "§2.2" },
  { id: "activity item 2 y", get: (q) => q("activity.item", 1).rect.y, expect: 92, tag: "arith", src: "§2.2" },
  { id: "activity item 5 y", get: (q) => q("activity.item", 4).rect.y, expect: 224, tag: "arith", src: "§2.2" },
  { id: "activity gear y", get: (q) => q("activity.item", 5).rect.y, expect: 824, tag: "arith", src: "§2.2" },
  { id: "activity count badge", get: (q) => { const a = q("activity.count").pseudo["::after"]; return `${a.minWidth} × ${a.height}, ${a.fontSize} ${a.fontWeight}`; }, expect: "14px × 14px, 9px 600", tag: "lit", src: "L:120" },

  // Explorer
  { id: "pane head height", get: (q) => q("left.head").rect.h, expect: 40, tag: "lit", src: "L:136" },
  { id: "pane head padding", get: (q) => q("left.head").style.padding, expect: "0px 8px 0px 15.2px", tag: "lit", src: "L:136" },
  { id: "pane label type", get: (q) => `${q("left.label").style.fontSize} ${q("left.label").style.fontWeight}`, expect: "13px 600", tag: "lit", src: "L:137" },
  { id: "pane tool button size", get: (q) => `${q("left.tool").rect.w} × ${q("left.tool").rect.h}`, expect: "26 × 26", tag: "lit", src: "S:109" },
  { id: "pane sub height", get: (q) => q("left.sub").rect.h, expect: 29.6, tag: "arith", src: "S:111" },
  { id: "pane sub type", get: (q) => `${q("left.sub").style.fontSize} ${q("left.sub").style.fontWeight}`, expect: "10.5px 500", tag: "lit", src: "L:138" },
  { id: "tree row height", get: (q) => q("tree.row").rect.h, expect: 26, tag: "lit", src: "L:147" },
  { id: "tree row type", get: (q) => `${q("tree.row").style.fontSize}/${q("tree.row").style.lineHeight}`, expect: "13px/20px", tag: "lit", src: "L:147, W:251" },
  { id: "tree row radius", get: (q) => q("tree.row").style.borderRadius, expect: "6px", tag: "lit", src: "W:259" },
  { id: "tree first row y", get: (q) => q("tree.row", 0).rect.y, expect: 113.6, tag: "arith", src: "§2.3" },
  { id: "tree row x", get: (q) => q("tree.row", 0).rect.x, expect: 65.2, tag: "arith", src: "L:146" },
  { id: "tree row width", get: (q) => q("tree.row", 0).rect.w, expect: 249.6, tag: "arith", src: "L:146" },
  { id: "tree last row bottom", get: (q) => q("tree.row", 11).rect.y + q("tree.row", 11).rect.h, expect: 425.6, tag: "arith", src: "§2.3" },
  { id: "tree twisty box", get: (q) => `${q("tree.twisty").rect.w} × ${q("tree.twisty").rect.h}`, expect: "16 × 16", tag: "lit", src: "W:280" },
  { id: "tree git mark type", get: (q) => `${q("tree.git").style.fontSize} ${q("tree.git").style.fontWeight}`, expect: "10.5px 600", tag: "lit", src: "L:158" },
  { id: "session row height", get: (q) => q("sessions.row").rect.h, expect: 46.4, tag: "arith", src: "§2.3" },
  { id: "session meta size", get: (q) => q("sessions.meta").style.fontSize, expect: "11px", tag: "lit", src: "L:162" },

  // editor
  { id: "tab height", get: (q) => q("tab.active").rect.h, expect: 28, tag: "lit", src: "L:168" },
  { id: "tab y", get: (q) => q("tab.active").rect.y, expect: 49, tag: "arith", src: "§2.4" },
  { id: "tab radius", get: (q) => q("tab.active").style.borderRadius, expect: "7px", tag: "lit", src: "L:168" },
  { id: "tab padding", get: (q) => q("tab.active").style.padding, expect: "0px 11.2px", tag: "lit", src: "L:168" },
  { id: "tab type", get: (q) => `${q("tab.active").style.fontSize} ${q("tab.active").style.fontWeight}`, expect: "13px 500", tag: "lit", src: "L:168" },
  { id: "tab strip wash height", get: (q) => q("tabs").pseudo["::after"].height, expect: "38px", tag: "lit", src: "L:106" },
  { id: "lit seam inset", get: (q) => `${q("tabs").pseudo["::before"].left} / ${q("tabs").pseudo["::before"].height}`, expect: "10px / 2px", tag: "lit", src: "L:85" },
  { id: "crumbs type", get: (q) => q("crumbs").style.fontSize, expect: "12px", tag: "lit", src: "S:127" },
  { id: "crumbs padding", get: (q) => q("crumbs").style.padding, expect: "0px 16px", tag: "lit", src: "L:174" },
  { id: "crumbs meta size", get: (q) => q("crumbs.meta").style.fontSize, expect: "11px", tag: "lit", src: "S:130" },
  { id: "code type", get: (q) => `${q("code").style.fontSize}/${q("code").style.lineHeight}`, expect: "13px/22px", tag: "lit", src: "L:178" },
  { id: "code padding top", get: (q) => q("code").style.paddingTop, expect: "12px", tag: "lit", src: "L:178" },
  { id: "line 36 y", get: (q) => q("code.line", 0).rect.y, expect: 124, tag: "arith", src: "§2.4" },
  { id: "current line y", get: (q) => q("code.line.cur").rect.y, expect: 234, tag: "arith", src: "§2.4" },
  { id: "current line height", get: (q) => q("code.line.cur").rect.h, expect: 22, tag: "lit", src: "L:178" },
  { id: "gutter width", get: (q) => q("code.no").rect.w, expect: 56, tag: "lit", src: "S:134" },
  { id: "gutter padding right", get: (q) => q("code.no").style.paddingRight, expect: "18px", tag: "lit", src: "S:134" },
  { id: "diagnostic pill", get: (q) => `${q("code.diag").style.borderRadius} ${q("code.diag").style.fontSize}`, expect: "5px 12px", tag: "lit", src: "L:181" },

  // bottom panel
  { id: "panel tab row height", get: (q) => q("panel.tabs").rect.h, expect: 38, tag: "lit", src: "L:184" },
  { id: "panel tab height", get: (q) => q("ptab.active").rect.h, expect: 26, tag: "lit", src: "S:145" },
  { id: "panel tab radius", get: (q) => q("ptab.active").style.borderRadius, expect: "6px", tag: "lit", src: "S:145" },
  { id: "panel tab type", get: (q) => `${q("ptab.active").style.fontSize} ${q("ptab.active").style.fontWeight}`, expect: "12.5px 500", tag: "lit", src: "L:186" },
  { id: "panel tab padding", get: (q) => q("ptab.active").style.padding, expect: "0px 9.6px", tag: "lit", src: "L:186" },
  { id: "terminal type", get: (q) => q("term").style.fontSize, expect: "12.5px", tag: "lit", src: "S:149" },
  { id: "terminal padding", get: (q) => q("term").style.padding, expect: "2.4px 9.6px 8px", tag: "lit", src: "L:189" },
  { id: "term block type", get: (q) => `${q("term.block").style.fontSize}/${q("term.block").style.lineHeight}`, expect: "12px/18px", tag: "lit", src: "W:448" },
  { id: "term block height", get: (q) => q("term.block").rect.h, expect: 62.7, tag: "arith", src: "§2.5" },
  { id: "term block radius", get: (q) => q("term.block").style.borderRadius, expect: "8px", tag: "lit", src: "L:190" },
  { id: "caret", get: (q) => `${q("term.caret").rect.w} × ${q("term.caret").rect.h}, r ${q("term.caret").style.borderRadius}`, expect: "7 × 15, r 1px", tag: "lit", src: "L:199" },

  // agent pane
  { id: "agent head padding", get: (q) => q("agent.head").style.padding, expect: "13.6px 16px", tag: "lit", src: "L:203" },
  { id: "agent title type", get: (q) => `${q("agent.title").style.fontSize} ${q("agent.title").style.fontWeight} ${q("agent.title").style.letterSpacing}`, expect: "16px 600 -0.4px", tag: "lit", src: "L:204" },
  { id: "agent eyebrow size", get: (q) => q("agent.eyebrow").style.fontSize, expect: "10.5px", tag: "lit", src: "L:138" },
  { id: "model tag height", get: (q) => q("agent.model").rect.h, expect: 19.9, tag: "arith", src: "§2.6" },
  { id: "model tag", get: (q) => `${q("agent.model").style.borderRadius} ${q("agent.model").style.fontSize}`, expect: "6px 11.5px", tag: "lit", src: "L:205" },
  { id: "tool list radius", get: (q) => q("agent.tools").style.borderRadius, expect: "8px", tag: "lit", src: "L:209" },
  { id: "tool row height", get: (q) => q("agent.tool", 0).rect.h, expect: 30.9, tag: "arith", src: "§2.6" },
  { id: "composer width", get: (q) => q("agent.composer").rect.w, expect: 328, tag: "arith", src: "S:178" },
  { id: "composer radius", get: (q) => q("agent.composer").style.borderRadius, expect: "12px", tag: "lit", src: "L:216" },
  { id: "composer textarea height", get: (q) => q("agent.textarea").rect.h, expect: 46.9, tag: "arith", src: "§2.6" },
  { id: "chip height", get: (q) => q("agent.chip").rect.h, expect: 24.1, tag: "arith", src: "§2.6" },
  { id: "chip radius", get: (q) => q("agent.chip").style.borderRadius, expect: "6px", tag: "lit", src: "L:279" },
  { id: "small button", get: (q) => `${q("agent.send").rect.h} ${q("agent.send").style.borderRadius} ${q("agent.send").style.fontSize}`, expect: "24 7px 12.5px", tag: "lit", src: "L:222" },
  { id: "check box", get: (q) => `${q("agent.check.box").rect.w} × ${q("agent.check.box").rect.h}, r ${q("agent.check.box").style.borderRadius}`, expect: "16 × 16, r 5px", tag: "lit", src: "L:264" },
  { id: "plan label size", get: (q) => q("agent.check.label").style.fontSize, expect: "13.5px", tag: "spec", src: "trap 9" },

  // status bar
  { id: "status bar padding", get: (q) => q("status").style.padding, expect: "0px 8px 0px 4px", tag: "lit", src: "L:124" },
  { id: "status item height", get: (q) => q("status.item").rect.h, expect: 22, tag: "lit", src: "L:125" },
  { id: "status item radius", get: (q) => q("status.item").style.borderRadius, expect: "6px", tag: "lit", src: "L:125" },
  { id: "status item padding", get: (q) => q("status.item").style.padding, expect: "0px 8px", tag: "lit", src: "L:125" },
  { id: "status first item x", get: (q) => q("status.item", 0).rect.x, expect: 4, tag: "arith", src: "L:124" },
  { id: "live dot size", get: (q) => `${q("status.dot").rect.w} × ${q("status.dot").rect.h}`, expect: "6 × 6", tag: "lit", src: "W:136" },

  // palette
  { id: "palette x", get: (q) => q("palette").rect.x, expect: 409, tag: "arith", src: "§2.8" },
  { id: "palette y", get: (q) => q("palette").rect.y, expect: 118, tag: "arith", src: "§2.8" },
  { id: "palette width", get: (q) => q("palette").rect.w, expect: 580, tag: "lit", src: "L:289" },
  { id: "palette height", get: (q) => q("palette").rect.h, expect: 312, tol: 4, tag: "arith", src: "§2.8 (approximate)" },
  { id: "palette radius", get: (q) => q("palette").style.borderRadius, expect: "14px", tag: "lit", src: "W:350" },
  { id: "palette head height", get: (q) => q("palette.head").rect.h, expect: 54, tag: "lit", src: "L:291" },
  { id: "palette input", get: (q) => `${q("palette.input").style.fontSize} h${q("palette.input").rect.h} r ${q("palette.input").style.borderRadius}`, expect: "16px h34 r 8px", tag: "lit", src: "L:292" },
  { id: "palette list padding", get: (q) => q("palette.list").style.padding, expect: "5.6px 8px 8px", tag: "lit", src: "L:295" },
  { id: "palette row height", get: (q) => q("palette.row").rect.h, expect: 38, tag: "lit", src: "L:296" },
  { id: "palette row radius", get: (q) => q("palette.row").style.borderRadius, expect: "8px", tag: "lit", src: "L:296" },
  { id: "palette scope chip", get: (q) => `${q("palette.scope").style.borderRadius} ${q("palette.scope").style.fontSize}`, expect: "6px 12px", tag: "lit", src: "L:294" },
  { id: "palette match weight", get: (q) => q("palette.mark").style.fontWeight, expect: "600", tag: "spec", src: "trap 5" },

  // toast
  { id: "toast x", get: (q) => q("toast").rect.x, expect: 708, tag: "arith", src: "§2.9" },
  { id: "toast right edge", get: (q) => q("toast").rect.x + q("toast").rect.w, expect: 1068, tag: "arith", src: "L:303" },
  { id: "toast bottom edge", get: (q) => q("toast").rect.y + q("toast").rect.h, expect: 852, tag: "arith", src: "L:303" },
  { id: "toast width", get: (q) => q("toast").rect.w, expect: 360, tag: "lit", src: "S:208" },
  { id: "toast height", get: (q) => q("toast").rect.h, expect: 66.2, tag: "arith", src: "§2.9" },
  { id: "toast radius", get: (q) => q("toast").style.borderRadius, expect: "12px", tag: "lit", src: "L:304" },
  { id: "toast padding", get: (q) => q("toast").style.padding, expect: "12.8px 12.8px 14.4px 16px", tag: "lit", src: "L:304" },
  { id: "toast mark size", get: (q) => `${q("toast.mark").rect.w} × ${q("toast.mark").rect.h}`, expect: "26 × 26", tag: "lit", src: "L:307" },
  { id: "toast dismiss", get: (q) => `${q("toast.dismiss").rect.w} × ${q("toast.dismiss").rect.h}, r ${q("toast.dismiss").style.borderRadius}`, expect: "32 × 32, r 8px", tag: "lit", src: "S:70" },

  // colours (§3), per theme
  { id: "canvas", get: (q) => q("app").style.backgroundColor, expect: { dark: "#08080b", light: "#e5e7ec" }, tag: "arith", src: "L:25, L:41" },
  { id: "surface (Explorer fill)", get: (q) => q("left").style.backgroundColor, expect: { dark: "#101114", light: "#fafbfd" }, tag: "arith", src: "L:26, L:42" },
  { id: "raised (code fill)", get: (q) => q("code").style.backgroundColor, expect: { dark: "#18191d", light: "#ffffff" }, tag: "arith", src: "L:27, L:43" },
  { id: "tile (active tab fill)", get: (q) => q("tab.active").style.backgroundColor, expect: { dark: "#212228", light: "#ffffff" }, tag: "arith", src: "L:35, L:51" },
  { id: "text (agent title)", get: (q) => q("agent.title").style.color, expect: { dark: "#eaebef", light: "#14161b" }, tag: "arith", src: "L:28, L:44" },
  { id: "text-secondary (tree row)", get: (q) => q("tree.name").style.color, expect: { dark: "#b9bac0", light: "#404249" }, tag: "arith", src: "L:29, L:45" },
  { id: "text-muted (command field)", get: (q) => q("title.cmd").style.color, expect: { dark: "#9a9ba2", light: "#585a63" }, tag: "arith", src: "L:30, L:46" },
  { id: "accent-text (selected tree icon)", get: (q) => q("tree.icon.sel").style.color, expect: { dark: "#8b96ff", light: "#393ccd" }, tag: "arith", src: "L:156" },
  { id: "accent (wordmark dot)", get: (q) => q("title.mark").pseudo["::after"].backgroundColor, expect: { dark: "#8b96ff", light: "#5b6cff" }, tag: "arith", src: "L:111" },
  { id: "accent fill (activity count)", get: (q) => q("activity.count").pseudo["::after"].backgroundColor, expect: { dark: "#4c58e9", light: "#4c58e9" }, tag: "arith", src: "S:32" },
  { id: "code fg", get: (q) => q("syntax.variable").style.color, expect: { dark: "#dcdee3", light: "#25262b" }, tag: "arith", src: "L:60, L:64" },
  { id: "syntax keyword", get: (q) => q("syntax.keyword").style.color, expect: { dark: "#a9b0fd", light: "#5847b7" }, tag: "arith", src: "L:61, L:65" },
  { id: "syntax string", get: (q) => q("syntax.string").style.color, expect: { dark: "#9ccf7f", light: "#316a23" }, tag: "arith", src: "§3" },
  { id: "syntax function", get: (q) => q("syntax.function").style.color, expect: { dark: "#75caf2", light: "#006197" }, tag: "arith", src: "§3 (light clipped)" },
  { id: "syntax number", get: (q) => q("syntax.number").style.color, expect: { dark: "#fd9976", light: "#b13e06" }, tag: "arith", src: "§3" },
  { id: "syntax builtin", get: (q) => q("syntax.type").style.color, expect: { dark: "#e5bf6d", light: "#875800" }, tag: "arith", src: "§3 (light clipped)" },
  { id: "syntax comment", get: (q) => q("syntax.comment").style.color, expect: { dark: "#9698a0", light: "#61636a" }, tag: "arith", src: "L:60, L:64" },
  { id: "term block fill (sunken)", get: (q) => q("term.block").style.backgroundColor, expect: { dark: "#0b0c0f", light: "#f6f7f9" }, tag: "spec", src: "trap 4" },
];

// ── main ─────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
const kit = path.resolve(args.kit ?? process.env.SONDALAB_UI_DIR ?? "");
if (!args.kit && !process.env.SONDALAB_UI_DIR) fail("pass --kit <sondalab-ui checkout> (or set SONDALAB_UI_DIR)");
if (!fs.existsSync(path.join(kit, STAGE))) fail(`${kit} has no ${STAGE}`);
const out = path.resolve(args.out ?? path.join(HERE, "reference"));
fs.mkdirSync(out, { recursive: true });

const port = args.port ? Number(args.port) : await freePort();
if (NEVER.has(port)) fail(`port ${port} is reserved on this machine`);
if (!(await isFree(port))) fail(`port ${port} is in use`);
const server = serve(kit, port);
const browser = await launchBrowser();
try {
  /** @type {Record<string, any>} */
  const measured = {};
  for (const theme of THEMES) {
    measured[theme] = await measureTheme(browser, port, theme);
    console.info(`measured ${theme}: ${Object.keys(measured[theme].regions).length} regions`);
  }
  const doc = {
    about:
      "The Lumen IDE demo measured as it renders, frozen as the parity reference for spexr. " +
      "Geometry in CSS px at device scale 1; colours as #rrggbb[aa], composited by the browser.",
    source: {
      repository: "sondalab-ui (private)",
      commit: git(kit, ["rev-parse", "--short", "HEAD"]),
      kitVersion: JSON.parse(fs.readFileSync(path.join(kit, "packages/ui-kit/package.json"), "utf8")).version,
      page: `${STAGE}?${QUERY("<theme>")}`,
    },
    browser: browser.version(),
    viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
    measuredOn: new Date().toISOString().slice(0, 10),
    themes: measured,
  };
  fs.writeFileSync(path.join(out, "demo-regions.json"), JSON.stringify(doc, null, 2) + "\n");
  fs.writeFileSync(path.join(out, "catalogue-check.md"), renderCheck(doc));
  console.info(`wrote ${path.relative(process.cwd(), out)}/{demo-dark,demo-light,demo-base-dark,demo-base-light}.png, demo-regions.json, catalogue-check.md`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

/**
 * Render one theme, settle it, screenshot it and measure every region.
 * @param {import("@playwright/test").Browser} browser
 * @param {number} port
 * @param {"dark" | "light"} theme
 */
async function measureTheme(browser, port, theme) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "no-preference" });
  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}/${STAGE}?${QUERY(theme)}`, { waitUntil: "load" });
    await page.waitForFunction(() => !!(/** @type {any} */ (window).slScreens), undefined, { timeout: 30_000 });
    const dir = await page.evaluate(() => /** @type {any} */ (window).slScreens.ready);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const health = await page.evaluate(() => /** @type {any} */ (window).slScreens.health());
    if (dir !== "lumen" || health.dir !== "lumen") throw new Error(`${theme}: the Lumen overlay did not apply (data-dir=${health.dir})`);
    if (health.errors.length) throw new Error(`${theme}: stage errors: ${health.errors.join("; ")}`);
    const broken = health.sheets.filter((s) => !s.ok);
    if (broken.length) throw new Error(`${theme}: stylesheets failed: ${broken.map((s) => s.href).join(", ")}`);

    const settled = await page.evaluate(settleAnimations);
    // Settling can start a transition (a class flip, a hover-free state); settle twice.
    const settledAgain = await page.evaluate(settleAnimations);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));

    const env = await page.evaluate(() => ({
      innerSize: `${innerWidth}x${innerHeight}`,
      devicePixelRatio,
      zoom: document.documentElement.style.zoom || "1",
      slTheme: document.documentElement.getAttribute("data-sl-theme"),
      fonts: [...document.fonts]
        .filter((f) => /Geist/.test(f.family))
        .map((f) => `${f.family.replace(/["']/g, "")} ${f.weight} ${f.style}: ${f.status}`),
    }));
    if (env.innerSize !== `${VIEWPORT.width}x${VIEWPORT.height}`) throw new Error(`${theme}: viewport ${env.innerSize}`);

    await page.screenshot({ path: path.join(out, `demo-${theme}.png`), animations: "allow" });
    const regions = await page.evaluate(collectRegions, { regions: REGIONS, maxItems: MAX_ITEMS });
    // The palette and the toast sit over the editor; spexr's base scene has
    // neither, so a second render without them is the one to compare it with.
    await page.addStyleTag({ content: ".ide-scrim, .ide-toasts { display: none !important; }" });
    await page.screenshot({ path: path.join(out, `demo-base-${theme}.png`), animations: "allow" });
    const missing = Object.entries(regions).filter(([, r]) => r.count === 0).map(([k]) => k);
    return { env: { ...env, animations: { ...settled, secondPass: settledAgain } }, missing, regions };
  } finally {
    await context.close();
  }
}

/**
 * In the page: finish every finite animation and transition, pause every
 * infinite one at t=0. Returns the counts, for the record.
 */
function settleAnimations() {
  let finished = 0;
  let paused = 0;
  for (const a of document.getAnimations()) {
    const timing = a.effect?.getComputedTiming();
    if (!timing) continue;
    if (timing.endTime === Infinity) {
      a.pause();
      a.currentTime = 0;
      paused++;
    } else {
      a.finish();
      finished++;
    }
  }
  return { finished, paused };
}

/**
 * In the page: rect, type and paint of every region. Colours are normalised to
 * #rrggbb[aa] by painting them on a canvas, so oklch and color-mix values
 * compare as what reaches the screen.
 * @param {{ regions: Array<[string, string, { all?: boolean; pseudo?: string[] }?]>; maxItems: number }} input
 */
function collectRegions({ regions, maxItems }) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (
    Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true })
  );
  const hex = (/** @type {string} */ c) => {
    if (!c || c === "none") return c;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgb(1, 2, 3)";
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const h = (/** @type {number} */ n) => n.toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}${a === 255 ? "" : h(a)}`;
  };
  const COLOR_FN = /\b(?:rgba?|hsla?|oklch|oklab|lch|lab|color|hwb)\((?:[^()]|\([^()]*\))*\)/g;
  const colors = (/** @type {string} */ s) => (s ? s.replace(COLOR_FN, (m) => hex(m)) : s);
  const r2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;
  const border = (/** @type {CSSStyleDeclaration} */ cs) => {
    const sides = ["Top", "Right", "Bottom", "Left"].map((s) => `${cs[`border${s}Width`]} ${cs[`border${s}Style`]} ${hex(cs[`border${s}Color`])}`);
    return sides.every((s) => s === sides[0]) ? sides[0] : sides.join(" | ");
  };
  const style = (/** @type {CSSStyleDeclaration} */ cs) => ({
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    letterSpacing: cs.letterSpacing,
    color: hex(cs.color),
    backgroundColor: hex(cs.backgroundColor),
    backgroundImage: colors(cs.backgroundImage),
    borderRadius: cs.borderRadius,
    border: border(cs),
    boxShadow: colors(cs.boxShadow),
    padding: cs.padding,
    paddingTop: cs.paddingTop,
    paddingRight: cs.paddingRight,
    gap: cs.gap,
    opacity: cs.opacity,
    transform: cs.transform,
  });
  const pseudoStyle = (/** @type {CSSStyleDeclaration} */ cs) => ({
    content: cs.content,
    display: cs.display,
    position: cs.position,
    top: cs.top,
    right: cs.right,
    bottom: cs.bottom,
    left: cs.left,
    width: cs.width,
    minWidth: cs.minWidth,
    height: cs.height,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    color: hex(cs.color),
    backgroundColor: hex(cs.backgroundColor),
    backgroundImage: colors(cs.backgroundImage),
    borderRadius: cs.borderRadius,
    boxShadow: colors(cs.boxShadow),
  });
  /** @type {Record<string, any>} */
  const out = {};
  for (const [name, selector, opts = {}] of regions) {
    const all = [...document.querySelectorAll(selector)];
    const els = opts.all ? all.slice(0, maxItems) : all.slice(0, 1);
    out[name] = {
      selector,
      count: all.length,
      items: els.map((el) => {
        const r = el.getBoundingClientRect();
        /** @type {Record<string, any>} */
        const pseudo = {};
        for (const p of opts.pseudo ?? []) {
          const cs = getComputedStyle(el, p);
          if (cs.content && cs.content !== "none" && cs.content !== "normal") pseudo[p] = pseudoStyle(cs);
        }
        return {
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 48),
          rect: { x: r2(r.x), y: r2(r.y), w: r2(r.width), h: r2(r.height) },
          style: style(getComputedStyle(el)),
          ...(Object.keys(pseudo).length ? { pseudo } : {}),
        };
      }),
    };
  }
  return out;
}

// ── catalogue-check.md ──────────────────────────────────────────────────
/** @param {any} doc */
function renderCheck(doc) {
  const rows = CHECKS.map((c) => {
    const values = Object.fromEntries(THEMES.map((t) => [t, read(doc.themes[t].regions, c)]));
    const expect = Object.fromEntries(THEMES.map((t) => [t, typeof c.expect === "object" && c.expect !== null ? c.expect[t] : c.expect]));
    const ok = Object.fromEntries(THEMES.map((t) => [t, agrees(values[t], expect[t], c.tol)]));
    return { c, values, expect, ok, agree: THEMES.every((t) => ok[t]) };
  });
  const off = rows.filter((r) => !r.agree);
  const fmt = (/** @type {unknown} */ v) => (v === undefined ? "missing" : typeof v === "number" ? String(px(v)) : String(v));
  const cell = (/** @type {string} */ s) => s.replace(/\|/g, "\\|");
  const same = (r) => THEMES.every((t) => fmt(r.values[t]) === fmt(r.values.dark)) && THEMES.every((t) => fmt(r.expect[t]) === fmt(r.expect.dark));
  const line = (r) =>
    same(r)
      ? `| ${r.c.id} | ${cell(fmt(r.expect.dark))} | ${cell(fmt(r.values.dark))} | ${r.c.tag} | ${r.c.src} |`
      : `| ${r.c.id} | ${THEMES.map((t) => `${t}: ${cell(fmt(r.expect[t]))}`).join("<br>")} | ${THEMES.map((t) => `${t}: ${cell(fmt(r.values[t]))}${r.ok[t] ? "" : " ✗"}`).join("<br>")} | ${r.c.tag} | ${r.c.src} |`;
  const byTag = (tag) => off.filter((r) => r.c.tag === tag).length;
  const missing = THEMES.flatMap((t) => doc.themes[t].missing.map((m) => `${t}: ${m}`));

  let md = `# Catalogue check: the Lumen IDE demo, measured\n\n`;
  md += `> **What this file is.** Where the demo, measured as it renders, disagrees with the catalogue of numbers computed from its CSS (the parity plan's catalogue, tagged [lit] for a CSS literal, [arith] for layout arithmetic and [spec] for a specificity reading). **Audience:** whoever implements a Lumen parity slice in spexr. **Owner:** the parity work. **Companions:** \`demo-regions.json\` (the measurement, authoritative), \`demo-dark.png\` and \`demo-light.png\` (the renders), \`demo-base-dark.png\` and \`demo-base-light.png\` (the same without the palette and the toast). Generated by \`tests/visual/measure-demo.mjs\`; do not edit by hand.\n\n`;
  md += `Source: sondalab-ui \`${doc.source.commit}\` (ui-kit ${doc.source.kitVersion}), \`${doc.source.page}\`, ${doc.viewport.width}×${doc.viewport.height} at device scale 1, ${doc.browser}, measured ${doc.measuredOn}. Lengths within ±0.5px agree (±${CHECKS.find((c) => c.tol)?.tol ?? 0}px where the catalogue says approximate); colours agree within 3 per channel.\n\n`;
  md += `**${off.length} of ${rows.length} checks disagree** (${byTag("arith")} [arith], ${byTag("lit")} [lit], ${byTag("spec")} [spec]). Where they disagree, \`demo-regions.json\` is the number to build to.\n\n`;
  if (missing.length) md += `Regions with no element in the demo: ${missing.join(", ")}.\n\n`;
  md += `## Disagreements\n\n| Check | Catalogue | Measured | Tag | Source |\n|---|---|---|---|---|\n`;
  md += off.map(line).join("\n") + "\n\n";
  md += `## Agreements\n\n<details><summary>${rows.length - off.length} checks agree</summary>\n\n| Check | Catalogue | Measured | Tag | Source |\n|---|---|---|---|---|\n`;
  md += rows.filter((r) => r.agree).map(line).join("\n") + "\n\n</details>\n";
  return md;
}

/** @param {Record<string, any>} regions @param {Check} c */
function read(regions, c) {
  /** @type {Query} */
  const q = (name, index = 0) => {
    const item = regions[name]?.items?.[index];
    if (!item) throw new Error("missing");
    return item;
  };
  try {
    return c.get(q);
  } catch {
    return undefined;
  }
}

/** @param {unknown} value @param {unknown} expect @param {number=} tol */
function agrees(value, expect, tol = 0.5) {
  if (value === undefined || value === null) return false;
  if (typeof expect === "number") return typeof value === "number" && Math.abs(value - expect) <= tol;
  if (typeof expect === "string" && /^#[0-9a-f]{6}$/i.test(expect)) {
    if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return false;
    return [1, 3, 5].every((i) => Math.abs(parseInt(value.slice(i, i + 2), 16) - parseInt(expect.slice(i, i + 2), 16)) <= 3);
  }
  // strings that carry lengths: compare each number within tolerance
  const nums = (/** @type {string} */ s) => s.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const words = (/** @type {string} */ s) => s.replace(/-?\d+(?:\.\d+)?/g, "#");
  const v = String(value);
  const e = String(expect);
  if (words(v) !== words(e)) return false;
  const a = nums(v);
  const b = nums(e);
  return a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) <= tol);
}

// ── plumbing ─────────────────────────────────────────────────────────────
/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) fail(`unexpected argument ${argv[i]}`);
    out[m[1]] = m[2] ?? argv[++i];
  }
  return out;
}

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(`measure-demo: ${message}`);
  process.exit(1);
}

/** @param {number} p */
function isFree(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(p, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

async function freePort() {
  for (let p = PORTS.from; p <= PORTS.to; p++) if (!NEVER.has(p) && (await isFree(p))) return p;
  return fail(`no free port in ${PORTS.from}-${PORTS.to}`);
}


/** A read-only static server for `root`, on loopback only. @param {string} root @param {number} p */
function serve(root, p) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(p, "127.0.0.1");
  return server;
}

/** System Chrome when installed, else Playwright's own Chromium. */
async function launchBrowser() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

/** @param {string} cwd @param {string[]} a */
function git(cwd, a) {
  try {
    return execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
