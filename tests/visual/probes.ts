import type { ElectronApplication, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { checkLights, findLights, inkAfter, type LightsCheck, type Rect } from "./lights";
import { nativeCapture } from "./native";

/** What the environment gave this capture: read by the step summary, never asserted on. */
export interface PageProbes {
  readonly webgl2: boolean;
  /** `webgl` / `canvas` / `dom`, read from the bottom terminal's xterm. */
  readonly xtermRenderer: string;
  readonly xtermDetail: string;
  readonly devicePixelRatio: number;
  readonly innerSize: string;
  readonly hasFocus: boolean;
  /** Monaco's line font, as computed on the rendered lines. */
  readonly editorFont: string;
  /** Advance of one character in the editor, measured on a rendered line. */
  readonly monacoCharWidth: number | null;
  /** The top panel, spexr's title bar: shown in either frame since S5b-1. */
  readonly topPanelVisible: boolean;
  /** Theia's in-page window controls: present only with a custom (frameless) window. */
  readonly windowControls: boolean;
  /** The bar's room for macOS's traffic lights (S5b-2): on macOS outside full screen only. */
  readonly trafficLights: boolean;
  /**
   * Where each part tagged `data-parity` is, in CSS px, keyed like the regions
   * of reference/demo-regions.json (`title.cmd`, …), plus Theia's window
   * controls as `title.controls` and the shell's own regions
   * ({@link SHELL_REGIONS}); one rect per element, in DOM order.
   */
  readonly parity: Record<string, Rects>;
  /**
   * spexr's font-readiness contribution: how the wait for Geist Mono ended
   * (`loaded`, `timeout`, `late`, `missing`, `failed`) and how many terminals
   * already existed when it re-measured (0: none had measured the fallback).
   */
  readonly codeFont: string | null;
  readonly codeFontTerminals: string | null;
  /** The bottom terminal's font as xterm resolves it now. */
  readonly terminalFont: TerminalFontProbe | null;
}

type Rects = Array<{ x: number; y: number; w: number; h: number }>;

/**
 * One region of Theia's own DOM, keyed like reference/demo-regions.json where
 * the demo has the same part (`tree.row`, `status.item`, …) and named for
 * spexr where it has none (`activity.right`). Measured by selector, so Theia's
 * DOM carries no attribute for the capture. `content` takes the element's
 * padding off its rect: an activity column holds the bar and the gap to its
 * island, and the demo's `activity` is the bar.
 */
export interface ShellRegion {
  readonly key: string;
  readonly selector: string;
  readonly content?: boolean;
}

/** The shell's regions in the base scene (S5c's geometry). */
export const SHELL_REGIONS: readonly ShellRegion[] = [
  { key: "body", selector: "#theia-left-right-split-panel" },
  { key: "activity", selector: "#theia-left-content-panel > .theia-app-sidebar-container", content: true },
  { key: "activity.item", selector: "#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab, #theia-left-content-panel .theia-sidebar-menu-item" },
  { key: "activity.current", selector: "#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab.lm-mod-current" },
  { key: "activity.badge", selector: "#theia-left-content-panel .lm-TabBar.theia-app-left .theia-badge-decorator-sidebar" },
  { key: "activity.right", selector: "#theia-right-content-panel > .theia-app-sidebar-container", content: true },
  { key: "activity.right.item", selector: "#theia-right-content-panel .lm-TabBar.theia-app-right .lm-TabBar-tab, #theia-right-content-panel .theia-sidebar-menu-item" },
  { key: "left", selector: '.spexr-island[data-island="left"]' },
  { key: "left.head", selector: "#theia-left-content-panel .theia-sidepanel-toolbar" },
  { key: "left.label", selector: "#theia-left-content-panel .theia-sidepanel-toolbar .theia-sidepanel-title" },
  { key: "left.sub", selector: "#theia-left-content-panel .theia-view-container-part-header" },
  { key: "tree.row", selector: "#files .theia-TreeNode" },
  { key: "tree.sel", selector: "#files .theia-TreeNode.theia-mod-selected" },
  { key: "tree.twisty", selector: "#files .theia-ExpansionToggle" },
  { key: "tree.name", selector: "#files .theia-TreeNode .theia-TreeNodeSegmentGrow" },
  { key: "main", selector: '.spexr-island[data-island="main"]' },
  { key: "tabs", selector: "#theia-main-content-panel .theia-tabBar-tab-row" },
  { key: "tab", selector: "#theia-main-content-panel .lm-TabBar-tab" },
  { key: "tab.active", selector: "#theia-main-content-panel .lm-TabBar.theia-tabBar-active .lm-TabBar-tab.lm-mod-current" },
  { key: "crumbs", selector: "#theia-main-content-panel .theia-tabBar-breadcrumb-row" },
  { key: "crumbs.item", selector: "#theia-main-content-panel .theia-breadcrumb-item" },
  { key: "code", selector: "#theia-main-content-panel .theia-editor" },
  { key: "panel", selector: '.spexr-island[data-island="bottom"]' },
  { key: "panel.tabs", selector: "#theia-bottom-content-panel .lm-TabBar" },
  { key: "ptab", selector: "#theia-bottom-content-panel .lm-TabBar-tab" },
  { key: "ptab.active", selector: "#theia-bottom-content-panel .lm-TabBar-tab.lm-mod-current" },
  { key: "agent", selector: '.spexr-island[data-island="right"]' },
  { key: "right.head", selector: "#theia-right-content-panel .theia-sidepanel-toolbar" },
  { key: "status", selector: "#theia-statusBar" },
  { key: "status.item", selector: "#theia-statusBar .area .element" },
];

/**
 * The right-panel scenes' regions (S5e), with TODO, Experts or Memory in front: the
 * island, the head and its parts, a card and its first row and check box.
 * The demo's counterparts are its agent pane's head, tool list and plan.
 */
export const RIGHT_PANEL_REGIONS: readonly ShellRegion[] = [
  { key: "rp.pane", selector: '.spexr-island[data-island="right"]' },
  { key: "rp.head", selector: "#theia-right-content-panel .spexr-panel-head" },
  { key: "rp.eyebrow", selector: "#theia-right-content-panel .spexr-panel-head__eyebrow" },
  { key: "rp.title", selector: "#theia-right-content-panel .spexr-panel-head__title" },
  { key: "rp.body", selector: "#theia-right-content-panel .spexr-panel-body" },
  { key: "rp.card", selector: "#theia-right-content-panel :is(.spexr-todo__file, .spexr-memory-list, .spexr-experts-list)" },
  { key: "rp.row", selector: "#theia-right-content-panel :is(.spexr-todo__item, .spexr-memory-list__item, .spexr-experts-list__item)" },
  { key: "rp.row.current", selector: '#theia-right-content-panel .spexr-experts-list__item[aria-current="true"]' },
  { key: "rp.check", selector: "#theia-right-content-panel .spexr-todo__item .sl-check__box" },
  { key: "rp.name", selector: "#theia-right-content-panel :is(.spexr-memory-list__name, .spexr-experts-list__name)" },
];

/**
 * The palette scene's regions (S5f), with the command palette open on a query:
 * the widget, its head and field, the list, the rows (a group's heading is not
 * one), the selected row, the group headings and the keycaps. The demo's
 * counterparts are `palette`, `palette.head`, `palette.input`, `palette.list`,
 * `palette.row`, `palette.row.sel`, `palette.group` and `palette.kbd`.
 */
export const PALETTE_REGIONS: readonly ShellRegion[] = [
  { key: "palette", selector: ".quick-input-widget" },
  { key: "palette.head", selector: ".quick-input-widget .quick-input-header" },
  { key: "palette.input", selector: ".quick-input-widget .quick-input-box .monaco-inputbox" },
  { key: "palette.list", selector: ".quick-input-widget .quick-input-list" },
  { key: "palette.row", selector: ".quick-input-list .monaco-list-row:not(:has(.quick-input-list-separator-as-item))" },
  { key: "palette.row.sel", selector: ".quick-input-list .monaco-list-row.focused" },
  { key: "palette.group", selector: ".quick-input-list .monaco-list-row:has(.quick-input-list-separator-as-item)" },
  { key: "palette.kbd", selector: ".quick-input-list .monaco-keybinding > .monaco-keybinding-key" },
];

/** The editor island the palette and the toasts are placed against. */
export const EDITOR_REGIONS: readonly ShellRegion[] = [{ key: "main", selector: '.spexr-island[data-island="main"]' }];

/** The toast scene's regions: the toast and its stack. */
export const TOAST_REGIONS: readonly ShellRegion[] = [
  { key: "toasts", selector: ".theia-notifications-container.theia-notification-toasts" },
  { key: "toast", selector: ".theia-notification-toasts .theia-notification-list-item" },
];

/**
 * Each region's rects, in CSS px, in DOM order: only elements that render
 * inside the window and are on top at their centre. Theia keeps hidden
 * editors, the side bars' invisible measuring copies of their tabs and tabs
 * scrolled out of a strip in the DOM.
 */
export async function probeRegions(page: Page, regions: readonly ShellRegion[]): Promise<Record<string, Rects>> {
  return page.evaluate((regions) => {
    const out: Record<string, Array<{ x: number; y: number; w: number; h: number }>> = {};
    const round = (n: number): number => Math.round(n * 100) / 100;
    for (const { key, selector, content } of regions) {
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || !el.checkVisibility({ visibilityProperty: true })) continue;
        if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) continue;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !el.contains(hit)) continue;
        let { x, y, width: w, height: h } = r;
        if (content) {
          const cs = getComputedStyle(el);
          const [l, t, rt, b] = [cs.paddingLeft, cs.paddingTop, cs.paddingRight, cs.paddingBottom].map(parseFloat) as [number, number, number, number];
          x += l;
          y += t;
          w -= l + rt;
          h -= t + b;
        }
        (out[key] ??= []).push({ x: round(x), y: round(y), w: round(w), h: round(h) });
      }
    }
    return out;
  }, regions);
}

export interface TerminalFontProbe {
  /** The family and size xterm measures with (its measure element's inline style). */
  readonly family: string;
  readonly size: string;
  /** The character box that element gives now, in CSS px: what a re-measure would read. */
  readonly box: { readonly width: number; readonly height: number } | null;
  /**
   * The cell xterm draws with, from its helper textarea: sized to one cell at
   * the cursor on every cursor move, so the shell's prompt leaves it current.
   */
  readonly cell: { readonly width: number; readonly height: number } | null;
  /** The drawn screen's height in CSS px, and that over the cell height: whole when the cell is current. */
  readonly screenHeight: number | null;
  readonly rows: number | null;
}

export interface MainProbes {
  readonly electron: string;
  readonly chromium: string;
  readonly node: string;
  readonly platform: string;
  readonly contentSize: string;
  readonly mediaSourceId: string;
  /** The window's outer bounds, `x,y wxh`: on macOS with the title bar hidden, the same size as the content. */
  readonly bounds: string;
  /** macOS: the traffic lights' position the window was created with (`trafficLightPosition`); null elsewhere. */
  readonly windowButtonPosition: { x: number; y: number } | null;
  /** `process.getSystemVersion()`: the macOS version on macOS ("26.6.2"). */
  readonly systemVersion: string;
}

/** The bar one zoom level out (83%), through Theia's own zoom route. */
export interface ZoomProbe {
  readonly level: number;
  readonly factor: number;
  /** The room the main process set for the page, before and after (LIGHTS_ROOM_PROPERTY). */
  readonly roomBefore: string;
  readonly roomAfter: string | null;
  /** The lights' position the main process moved them to. */
  readonly windowButtonPosition: { x: number; y: number } | null;
  /** The mark's left edge in points, and its distance from the last light's right edge. */
  readonly markLeftPt: number | null;
  readonly markGapPt: number | null;
  readonly lights?: LightsCheck;
  /**
   * Whether the native capture shows the zoomed page: the mark's first ink
   * column where the DOM puts it, within 1pt, after `attempts` captures.
   */
  readonly settle: { readonly settled: boolean; readonly attempts: number; readonly inkPt: number | null; readonly expectedPt: number | null };
  readonly ok: boolean;
  readonly problems: string[];
}

/** One full-screen transition, driven from the main process as the green button would. */
export interface FullScreenStep {
  /** Whether the window emitted the transition's event before the timeout. */
  readonly event: boolean;
  /** From that event until the bar's room for the lights had gone (entering) or come back (leaving); null if it never did. */
  readonly answeredMs: number | null;
  /** Whether the bar has the lights' room once the step is over. */
  readonly trafficLights: boolean;
  /** The mark's x once the step is over. */
  readonly markX: number | null;
}

export interface FullScreenProbe {
  enter?: FullScreenStep;
  leave?: FullScreenStep;
  error?: string;
}

export interface LogProbes {
  /** From the plugin deployer: "Deploy batch of N accepted plugins". */
  readonly deployedPlugins: number | null;
  /**
   * "The local plugin referenced by … does not exist." lines, except Theia's
   * own per-user plugin folders under the config dir, which a fresh profile
   * never has; those are counted in `userPluginDirsMissing`.
   */
  readonly missingPluginPaths: string[];
  readonly userPluginDirsMissing: number;
}

/** One sampled part of the editor: where it is on the page, what it says and the colour it computes to. */
export interface EditorSample {
  readonly text: string;
  readonly rect: { x: number; y: number; w: number; h: number };
  readonly color: string;
  readonly background: string;
  readonly fontStyle: string;
}

/**
 * The editor as Monaco lays it out and paints it (S5d), in CSS px, read from
 * the DOM: the gutter's edges from the editor's left edge, the colours its
 * theme resolves to, a token of each type with its colour and rect (so the
 * capture's pixels can be sampled there), the terminal's registry palette.
 * The demo's numbers are in reference/demo-regions.json (`code.no`, `code.tx`,
 * `syntax.*`); `paddingTop` is read by {@link probeEditorPadding}.
 */
export interface EditorProbe {
  readonly editor: { x: number; y: number; w: number; h: number } | null;
  /** Right edge of the line numbers' text, from the editor's left edge (demo 38). */
  readonly numbersRight: number | null;
  /** Left edge of the lines' text, from the editor's left edge (demo 56). */
  readonly textLeft: number | null;
  readonly lineHeight: number | null;
  readonly fontSize: number | null;
  /** The current line's wash, and the selection's, as the editor paints them. */
  readonly currentLine: EditorSample | null;
  readonly selection: EditorSample | null;
  readonly lineNumber: EditorSample | null;
  readonly activeLineNumber: EditorSample | null;
  /** A token of each type, found by its text in the visible lines: keyword, string, function, number, type, comment, variable. */
  readonly tokens: Record<string, EditorSample | null>;
  /** The colours Monaco's theme resolves to on the editor (`--vscode-*`). */
  readonly monacoColors: Record<string, string>;
  /** Theia's terminal colours from the colour registry (`--theia-terminal-*`), the palette xterm is given. */
  readonly terminalColors: Record<string, string>;
  /** The Monaco theme the page has set, as the class on the body. */
  readonly bodyEditorTheme: string | null;
  /** Monaco's minimap, shown or not. */
  readonly minimap: boolean;
}

/** Reads {@link EditorProbe} from the page. */
export async function probeEditor(page: Page): Promise<EditorProbe> {
  return page.evaluate(() => {
    const round = (n: number): number => Math.round(n * 100) / 100;
    const editor = [...document.querySelectorAll<HTMLElement>("#theia-main-content-panel .monaco-editor")].find(
      (e) => e.getBoundingClientRect().width > 0 && e.querySelector(".view-lines") && e.checkVisibility({ visibilityProperty: true }),
    );
    const none = {
      editor: null,
      numbersRight: null,
      textLeft: null,
      lineHeight: null,
      fontSize: null,
      currentLine: null,
      selection: null,
      lineNumber: null,
      activeLineNumber: null,
      tokens: {},
      monacoColors: {},
      terminalColors: {},
      bodyEditorTheme: null,
      minimap: false,
    };
    if (!editor) return none;
    const er = editor.getBoundingClientRect();
    const rectOf = (el: Element): { x: number; y: number; w: number; h: number } => {
      const r = el.getBoundingClientRect();
      return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) };
    };
    const textRect = (el: Element): DOMRect => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    };
    const sample = (el: Element | null | undefined, ink?: Element): EditorSample | null => {
      if (!el) return null;
      const cs = getComputedStyle(ink ?? el);
      const bg = getComputedStyle(el).backgroundColor;
      return { text: (el.textContent ?? "").trim().slice(0, 40), rect: rectOf(ink ?? el), color: cs.color, background: bg, fontStyle: cs.fontStyle };
    };
    const lineNumbers = [...editor.querySelectorAll<HTMLElement>(".margin-view-overlays .line-numbers")].filter((el) => (el.textContent ?? "").trim() !== "");
    const plain = lineNumbers.find((el) => !el.classList.contains("active-line-number"));
    const active = lineNumbers.find((el) => el.classList.contains("active-line-number"));
    const firstNumber = plain ?? lineNumbers[0];
    const viewLine = [...editor.querySelectorAll<HTMLElement>(".view-lines .view-line")].find((el) => (el.textContent ?? "").trim().length > 10);
    const cs = viewLine ? getComputedStyle(viewLine) : null;

    const leaves = [...editor.querySelectorAll<HTMLElement>(".view-lines .view-line span")].filter((el) => el.children.length === 0 && (el.textContent ?? "").trim() !== "");
    const find = (test: (text: string) => boolean): EditorSample | null => {
      const el = leaves.find((l) => test((l.textContent ?? "").trim()));
      return el ? sample(el, el) : null;
    };
    const tokens: Record<string, EditorSample | null> = {
      keyword: find((t) => /^(import|const|await|return|if|export|new|from)$/.test(t)),
      string: find((t) => /^"[^"]*"$/.test(t)),
      function: find((t) => /^(read|stale|run|write|resolve)$/.test(t)),
      number: find((t) => /^[\d_]+$/.test(t)),
      type: find((t) => /^(Probe|Answer|Cache|Promise|Evidence)$/.test(t)),
      comment: find((t) => t.startsWith("//")),
      variable: find((t) => /\b(hit|probe|answer|evidence)\b/.test(t) && !/^(\/\/|import|const|await|return|if|export|new|from)/.test(t)),
    };

    const ecs = getComputedStyle(editor);
    const monacoColors: Record<string, string> = {};
    for (const name of ["editor-background", "editor-foreground", "editor-lineHighlightBackground", "editor-lineHighlightBorder", "editor-selectionBackground", "editor-inactiveSelectionBackground", "editorLineNumber-foreground", "editorLineNumber-activeForeground", "editorCursor-foreground", "editorGutter-background"]) {
      monacoColors[name] = ecs.getPropertyValue(`--vscode-${name}`).trim();
    }
    const root = getComputedStyle(document.documentElement);
    const terminalColors: Record<string, string> = {};
    for (const name of ["foreground", "background", "selectionBackground", "ansiBlack", "ansiRed", "ansiGreen", "ansiYellow", "ansiBlue", "ansiMagenta", "ansiCyan", "ansiWhite", "ansiBrightBlack", "ansiBrightRed", "ansiBrightGreen", "ansiBrightYellow", "ansiBrightBlue", "ansiBrightMagenta", "ansiBrightCyan", "ansiBrightWhite"]) {
      terminalColors[name] = root.getPropertyValue(`--theia-terminal-${name}`).trim();
    }
    const minimap = editor.querySelector<HTMLElement>(".minimap");
    return {
      editor: rectOf(editor),
      numbersRight: firstNumber ? round(textRect(firstNumber).right - er.left) : null,
      textLeft: viewLine ? round(viewLine.getBoundingClientRect().left - er.left) : null,
      lineHeight: cs ? parseFloat(cs.lineHeight) : null,
      fontSize: cs ? parseFloat(cs.fontSize) : null,
      currentLine: sample(editor.querySelector(".view-overlays .current-line, .margin-view-overlays .current-line")),
      selection: sample(editor.querySelector(".cslr.selected-text, .selected-text")),
      lineNumber: sample(plain),
      activeLineNumber: sample(active),
      tokens,
      monacoColors,
      terminalColors,
      bodyEditorTheme: [...document.body.classList].find((c) => /^(spexr-|dark-theia|light-theia|hc-)/.test(c)) ?? null,
      minimap: !!minimap && minimap.getBoundingClientRect().width > 0,
    };
  });
}

/**
 * The editor's padding at the top: with the cursor on line 1 and the editor
 * scrolled to the top, how far line 1's number sits below the editor's top
 * edge (demo 12, the code block's `padding-top`). Clicks into the editor and
 * presses the go-to-start key, so the capture's scenes must be over; returns
 * null when no editor shows or line 1 never came into view.
 */
export async function probeEditorPadding(page: Page): Promise<{ paddingTop: number; firstLine: number } | null> {
  const box = await page.evaluate(() => {
    const editor = [...document.querySelectorAll<HTMLElement>("#theia-main-content-panel .monaco-editor")].find(
      (e) => e.getBoundingClientRect().width > 0 && e.querySelector(".view-lines") && e.checkVisibility({ visibilityProperty: true }),
    );
    const r = editor?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (!box) return null;
  await page.mouse.click(box.x, box.y);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const editor = [...document.querySelectorAll<HTMLElement>("#theia-main-content-panel .monaco-editor")].find(
      (e) => e.getBoundingClientRect().width > 0 && e.querySelector(".view-lines") && e.checkVisibility({ visibilityProperty: true }),
    );
    if (!editor) return null;
    const top = editor.getBoundingClientRect().top;
    const numbers = [...editor.querySelectorAll<HTMLElement>(".margin-view-overlays .line-numbers")]
      .map((el) => ({ n: Number(el.textContent?.trim()), y: el.getBoundingClientRect().top - top }))
      .filter((l) => Number.isFinite(l.n) && l.n > 0)
      .sort((a, b) => a.y - b.y);
    const first = numbers.find((l) => l.n === 1);
    return first ? { paddingTop: Math.round(first.y * 100) / 100, firstLine: 1 } : null;
  });
}

export async function probePage(page: Page): Promise<PageProbes> {
  const probes = await probeTagged(page);
  return { ...probes, parity: { ...probes.parity, ...(await probeRegions(page, SHELL_REGIONS)) } };
}

async function probeTagged(page: Page): Promise<PageProbes> {
  return page.evaluate(() => {
    let webgl2 = false;
    try {
      webgl2 = !!document.createElement("canvas").getContext("webgl2");
    } catch {
      webgl2 = false;
    }
    const term = document.querySelector<HTMLElement>("#theia-bottom-content-panel .xterm") ?? document.querySelector<HTMLElement>(".xterm");
    let xtermRenderer = "none";
    let xtermDetail = "no terminal";
    if (term) {
      const canvases = [...term.querySelectorAll("canvas")];
      const rows = term.querySelector(".xterm-rows");
      const classes = canvases.map((c) => c.className || "(no class)");
      const gl = canvases.some((c) => {
        try {
          return !!(c.getContext("webgl2") || c.getContext("webgl"));
        } catch {
          return false;
        }
      });
      xtermRenderer = rows && rows.childElementCount > 0 ? "dom" : canvases.length === 0 ? "none" : gl ? "webgl" : "canvas";
      xtermDetail = `${canvases.length} canvas [${classes.join(", ")}], dom rows ${rows ? rows.childElementCount : 0}`;
    }

    // A visible line with enough text to average over; hidden editors stay in the DOM.
    const line = [...document.querySelectorAll<HTMLElement>(".monaco-editor .view-lines .view-line")].find(
      (el) => (el.textContent ?? "").trim().length > 20 && el.getBoundingClientRect().width > 0,
    );
    let monacoCharWidth: number | null = null;
    let editorFont = "no editor";
    if (line) {
      const cs = getComputedStyle(line);
      editorFont = `${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
      const range = document.createRange();
      range.selectNodeContents(line);
      const text = line.textContent ?? "";
      monacoCharWidth = text.length ? Math.round((range.getBoundingClientRect().width / text.length) * 1000) / 1000 : null;
    }
    let terminalFont: TerminalFontProbe | null = null;
    if (term) {
      const measure = term.querySelector<HTMLElement>(".xterm-char-measure-element");
      const textarea = term.querySelector<HTMLElement>(".xterm-helper-textarea");
      const screen = term.querySelector<HTMLElement>(".xterm-screen");
      const len = measure?.textContent?.length ?? 0;
      const px = (v: string | undefined): number | null => (v && Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
      const cellW = px(textarea?.style.width);
      const cellH = px(textarea?.style.height);
      const screenHeight = px(screen?.style.height) ?? (screen ? screen.getBoundingClientRect().height : null);
      terminalFont = {
        family: measure?.style.fontFamily ?? "",
        size: measure?.style.fontSize ?? "",
        box: measure && len ? { width: Math.round((measure.offsetWidth / len) * 1000) / 1000, height: measure.offsetHeight } : null,
        cell: cellW !== null && cellH !== null ? { width: cellW, height: cellH } : null,
        screenHeight,
        rows: screenHeight !== null && cellH ? Math.round((screenHeight / cellH) * 1000) / 1000 : null,
      };
    }
    const top = document.getElementById("theia-top-panel");
    const parity: Record<string, Array<{ x: number; y: number; w: number; h: number }>> = {};
    const round = (n: number): number => Math.round(n * 100) / 100;
    // Monaco's list rows carry data-parity too, as even/odd.
    const tagged: Array<[string, Element]> = [...document.querySelectorAll<HTMLElement>("[data-parity]")]
      .map((el): [string, Element] => [el.dataset.parity ?? "?", el])
      .filter(([key]) => key !== "even" && key !== "odd");
    const controls = document.getElementById("window-controls");
    if (controls) tagged.push(["title.controls", controls]);
    for (const [key, el] of tagged) {
      const r = el.getBoundingClientRect();
      (parity[key] ??= []).push({ x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) });
    }
    return {
      webgl2,
      xtermRenderer,
      xtermDetail,
      devicePixelRatio: window.devicePixelRatio,
      innerSize: `${window.innerWidth}x${window.innerHeight}`,
      hasFocus: document.hasFocus(),
      editorFont,
      monacoCharWidth,
      topPanelVisible: !!top && !top.classList.contains("lm-mod-hidden") && top.getBoundingClientRect().height > 0,
      windowControls: !!document.getElementById("window-controls"),
      trafficLights: !!document.querySelector('[data-parity="title.dots"]'),
      parity,
      codeFont: document.body.dataset.spexrCodeFont ?? null,
      codeFontTerminals: document.body.dataset.spexrCodeFontTerminals ?? null,
      terminalFont,
    };
  });
}

export async function probeMain(app: ElectronApplication): Promise<MainProbes> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const [w, h] = win ? win.getContentSize() : [0, 0];
    const b = win?.getBounds();
    return {
      electron: process.versions.electron ?? "",
      chromium: process.versions.chrome ?? "",
      node: process.versions.node ?? "",
      platform: `${process.platform}-${process.arch}`,
      contentSize: `${w}x${h}`,
      mediaSourceId: win ? win.getMediaSourceId() : "",
      bounds: b ? `${b.x},${b.y} ${b.width}x${b.height}` : "",
      windowButtonPosition: win && process.platform === "darwin" ? (win.getWindowButtonPosition() ?? null) : null,
      systemVersion: process.getSystemVersion(),
    };
  });
}

/** The first `data-parity` rect of `key` on the page, in CSS px. */
async function parityRect(page: Page, key: string): Promise<Rect | undefined> {
  return page.evaluate((key) => {
    const r = document.querySelector(`[data-parity="${key}"]`)?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : undefined;
  }, key);
}

/** The room the main process has set on the page, as the computed custom property. */
async function roomProperty(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--spexr-traffic-lights").trim());
}

/**
 * macOS's traffic lights in the native capture at 100%, checked against the
 * bar: inside its room (`title.dots`) and centred on it (lights.ts).
 */
export async function probeLights(file: string, page: Page, windowWidth: number): Promise<LightsCheck> {
  const found = await findLights(file, windowWidth);
  const bar = await parityRect(page, "title");
  const check = checkLights(file, found, 1, bar, await parityRect(page, "title.dots"));
  const mark = await parityRect(page, "title.mark");
  const right = found.circles.length ? Math.max(...found.circles.map((c) => c.right)) : null;
  const markInkPt = right !== null && bar ? await inkAfter(file, windowWidth, right, bar.y + bar.h / 2) : null;
  return { ...check, markPt: mark?.x ?? null, markInkPt };
}

/** Two animation frames, then a short wait: the compositor has presented what the DOM holds. */
async function presented(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            clearTimeout(timer);
            resolve();
          }),
        );
      }),
  );
  await page.waitForTimeout(150);
}

/**
 * macOS only: one zoom level out through Theia's zoom route (the page's
 * setZoomLevel, which the main process applies), a native capture, and the
 * lights checked against the bar there: centred on it, and the mark a gap
 * clear of them. Zoom goes back to 100% after.
 */
export async function probeZoom(app: ElectronApplication, page: Page, base: string, atFull?: LightsCheck, level = -1): Promise<ZoomProbe> {
  const factor = Math.pow(1.2, level);
  const problems: string[] = [];
  const roomBefore = await roomProperty(page);
  const setZoom = (to: number): Promise<void> =>
    page.evaluate((to) => (window as unknown as { electronTheiaCore: { setZoomLevel(level: number): void } }).electronTheiaCore.setZoomLevel(to), to);
  let roomAfter: string | null = null;
  let lights: LightsCheck | undefined;
  let windowButtonPosition: { x: number; y: number } | null = null;
  let markLeftPt: number | null = null;
  let markGapPt: number | null = null;
  let settle: ZoomProbe["settle"] = { settled: false, attempts: 0, inkPt: null, expectedPt: null };
  try {
    await setZoom(level);
    roomAfter = await page
      .waitForFunction(
        (before) => {
          const now = getComputedStyle(document.documentElement).getPropertyValue("--spexr-traffic-lights").trim();
          return now && now !== before ? now : false;
        },
        roomBefore,
        { timeout: 10_000 },
      )
      .then((handle) => handle.jsonValue() as Promise<string>)
      .catch(() => null);
    if (roomAfter === null) problems.push(`the room stayed ${roomBefore || "unset"}`);
    windowButtonPosition = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getWindowButtonPosition() ?? null);
    const width = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds().width ?? 0);
    const bar = await parityRect(page, "title");
    const mark = await parityRect(page, "title.mark");
    // The capture is of the screen, not the DOM: it is taken again until the
    // mark's ink sits where the DOM puts it, scaled, plus the glyph's side
    // bearing as the 100% capture measured it.
    const bearing = typeof atFull?.markInkPt === "number" && typeof atFull.markPt === "number" ? atFull.markInkPt - atFull.markPt : 0;
    const expectedPt = mark ? mark.x * factor + bearing * factor : null;
    let file: string | undefined;
    for (let attempt = 1; attempt <= 6; attempt++) {
      await presented(page);
      const shot = (await nativeCapture(app, base)).find((s) => s.ok);
      if (!shot) break;
      file = path.join(path.dirname(base), shot.file);
      const found = await findLights(file, width);
      const right = found.circles.length ? Math.max(...found.circles.map((c) => c.right)) : null;
      const inkPt = right !== null && bar ? await inkAfter(file, width, right, (bar.y + bar.h / 2) * factor) : null;
      const settled = inkPt !== null && expectedPt !== null && Math.abs(inkPt - expectedPt) <= 1;
      settle = { settled, attempts: attempt, inkPt, expectedPt };
      if (settled) break;
      await page.waitForTimeout(250);
    }
    if (!file) problems.push("no native capture");
    else {
      if (!settle.settled) problems.push(`the capture never showed the zoomed page: mark ink at ${settle.inkPt}pt, the DOM's at ${settle.expectedPt}pt`);
      const found = await findLights(file, width);
      lights = checkLights(file, found, factor, bar, await parityRect(page, "title.dots"));
      problems.push(...lights.problems);
      const lastRight = Math.max(...found.circles.map((c) => c.right));
      if (mark && found.circles.length) {
        markLeftPt = mark.x * factor;
        markGapPt = markLeftPt - lastRight;
        if (markGapPt < 12 * factor - 1) problems.push(`the mark is ${markGapPt}pt from the lights, under the gap of ${12 * factor}pt`);
      }
    }
  } finally {
    await setZoom(0);
    await page
      .waitForFunction((before) => getComputedStyle(document.documentElement).getPropertyValue("--spexr-traffic-lights").trim() === before, roomBefore, {
        timeout: 10_000,
      })
      .catch(() => problems.push("the room did not come back at 100%"));
  }
  return { level, factor, roomBefore, roomAfter, windowButtonPosition, markLeftPt, markGapPt, lights, settle, ok: problems.length === 0, problems };
}

/**
 * macOS only, the run's last step: full screen on and off from the main
 * process, which takes the same route as the green button and the system
 * menu, so the bar has to follow Electron's events, not Theia's command.
 * Best-effort: a runner that cannot enter full screen records why and the
 * capture goes on. `shot` takes the page's bar while in full screen.
 */
export async function probeFullScreen(app: ElectronApplication, page: Page, shot?: string): Promise<FullScreenProbe> {
  const probe: FullScreenProbe = {};
  try {
    probe.enter = await fullScreenStep(app, page, true);
    if (shot) await page.screenshot({ path: shot });
    probe.leave = await fullScreenStep(app, page, false);
  } catch (err) {
    probe.error = String(err instanceof Error ? err.message : err);
  }
  return probe;
}

async function fullScreenStep(app: ElectronApplication, page: Page, on: boolean): Promise<FullScreenStep> {
  const event = await app.evaluate(
    ({ BrowserWindow }, on) =>
      new Promise<boolean>((resolve) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return resolve(false);
        const timer = setTimeout(() => resolve(false), 20_000);
        const done = (): void => {
          clearTimeout(timer);
          resolve(true);
        };
        if (on) win.once("enter-full-screen", done);
        else win.once("leave-full-screen", done);
        win.setFullScreen(on);
      }),
    on,
  );
  const since = Date.now();
  const answered = await page
    .waitForFunction((on) => !document.querySelector('[data-parity="title.dots"]') === on, on, { timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  const answeredMs = answered ? Date.now() - since : null;
  const after = await page.evaluate(() => ({
    trafficLights: !!document.querySelector('[data-parity="title.dots"]'),
    markX: document.querySelector('[data-parity="title.mark"]')?.getBoundingClientRect().x ?? null,
  }));
  return { event, answeredMs, ...after };
}

export function probeLog(logFile: string, configDir: string): LogProbes {
  const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  const batches = [...text.matchAll(/Deploy batch of (\d+) accepted plugins/g)].map((m) => Number(m[1]));
  const missing = [...new Set([...text.matchAll(/The local plugin referenced by (\S+) does not exist/g)].map((m) => m[1] ?? ""))];
  const userDirs = new Set(["plugins", "deployedPlugins"].map((d) => `local-dir:${path.join(configDir, d)}`));
  return {
    deployedPlugins: batches.length ? batches.reduce((a, b) => a + b, 0) : null,
    missingPluginPaths: missing.filter((m) => !userDirs.has(m)),
    userPluginDirsMissing: missing.filter((m) => userDirs.has(m)).length,
  };
}
