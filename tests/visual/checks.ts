/**
 * Assertions of the palette, toast and lit-rim scenes (S5f). Each returns the
 * problems it found, and the capture throws when there are any: a scene that
 * is not what it is meant to show fails the run, not only the picture.
 *
 * The numbers are the geometry table's (packages/theia-extensions/src/browser/
 * shell/workbench-geometry.ts: PALETTE, TOAST, WORKBENCH), which a test there
 * holds to the CSS; they are repeated here because this package does not
 * import the extension.
 */
import type { Page } from "@playwright/test";
// The order is the extension's own rule (pure, Theia-free), so the capture checks against it rather than a copy.
import { bottomOrder } from "../../packages/theia-extensions/src/browser/shell/bottom-panel";
import { OUTLINE_GLYPH } from "../../packages/theia-extensions/src/browser/theme/outline-icons";

export type Rects = Array<{ x: number; y: number; w: number; h: number }>;
export type Regions = Record<string, Rects>;

const PALETTE = { width: 580, top: 118, row: 36, group: 28, head: 52, field: 32, key: 20, keyGap: 4 };
const TOAST = { width: 360, inset: 8, offset: 48 };

const near = (actual: number, want: number, tol: number): boolean => Math.abs(actual - want) <= tol;

/**
 * The open command palette, against the editor island: centred on it, 580
 * wide and 118 from the window's top; at least three entry rows of 36px,
 * exactly one of them selected, a 52px head with a 32px field, and keycaps of
 * 20px, 4px apart.
 */
export function checkPalette(regions: Regions, main: Rects | undefined, viewport: { width: number; height: number }): string[] {
  const problems: string[] = [];
  const viewportWidth = viewport.width;
  const widget = regions["palette"]?.[0];
  if (!widget) return ["palette: the widget is not on screen"];
  const want = Math.min(PALETTE.width, viewportWidth - 16);
  if (!near(widget.w, want, 1)) problems.push(`palette: ${widget.w}px wide, want ${want}`);
  if (!near(widget.y, PALETTE.top, 1)) problems.push(`palette: top ${widget.y}, want ${PALETTE.top}`);
  const island = main?.[0];
  if (!island) problems.push("palette: no editor island to centre on");
  else if (!near(widget.x + widget.w / 2, island.x + island.w / 2, 1.5)) {
    problems.push(`palette: centre ${widget.x + widget.w / 2}, the editor island's ${island.x + island.w / 2}`);
  }
  if (widget.y + widget.h > viewport.height) problems.push(`palette: ends at ${widget.y + widget.h}, past the window's ${viewport.height}`);
  const rows = regions["palette.row"] ?? [];
  if (rows.length < 3) problems.push(`palette: ${rows.length} entry rows, want at least 3 (the query must find several)`);
  for (const [i, row] of rows.entries()) if (!near(row.h, PALETTE.row, 0.5)) problems.push(`palette: row ${i} is ${row.h}px tall, want ${PALETTE.row}`);
  const selected = regions["palette.row.sel"] ?? [];
  if (selected.length !== 1) problems.push(`palette: ${selected.length} selected rows, want exactly 1`);
  for (const [i, group] of (regions["palette.group"] ?? []).entries()) if (!near(group.h, PALETTE.group, 0.5)) problems.push(`palette: group ${i} is ${group.h}px tall, want ${PALETTE.group}`);
  const head = regions["palette.head"]?.[0];
  if (!head) problems.push("palette: no head");
  else if (!near(head.h, PALETTE.head, 1)) problems.push(`palette: head ${head.h}px, want ${PALETTE.head}`);
  const field = regions["palette.input"]?.[0];
  if (!field) problems.push("palette: no field");
  else if (!near(field.h, PALETTE.field, 1)) problems.push(`palette: field ${field.h}px, want ${PALETTE.field}`);
  const keys = regions["palette.kbd"] ?? [];
  if (keys.length === 0) problems.push("palette: no keycap on screen (the query must find a command with a shortcut)");
  for (const [i, key] of keys.entries()) {
    if (!near(key.h, PALETTE.key, 1) || key.w < PALETTE.key - 1) problems.push(`palette: keycap ${i} is ${key.w}x${key.h}, want at least ${PALETTE.key}x${PALETTE.key}`);
    const next = keys[i + 1];
    if (next && near(next.y, key.y, 1) && next.x > key.x) {
      const gap = next.x - (key.x + key.w);
      // A chord's 6px separator makes a wider gap, which is not a cap's neighbour.
      if (gap < 8 && !near(gap, PALETTE.keyGap, 1)) problems.push(`palette: keycaps ${i} and ${i + 1} are ${gap}px apart, want ${PALETTE.keyGap}`);
    }
  }
  return problems;
}

/**
 * The toast on screen, against the editor island: 360 wide, ending 8px inside
 * the island's right edge, its stack ending 48px above the window's bottom.
 */
export function checkToast(regions: Regions, main: Rects | undefined, viewportHeight: number): string[] {
  const problems: string[] = [];
  const stack = regions["toasts"]?.[0];
  const toast = regions["toast"]?.[0];
  if (!stack || !toast) return ["toast: no toast on screen"];
  if (!near(toast.w, TOAST.width, 1)) problems.push(`toast: ${toast.w}px wide, want ${TOAST.width}`);
  const island = main?.[0];
  if (!island) problems.push("toast: no editor island to end at");
  else if (!near(toast.x + toast.w, island.x + island.w - TOAST.inset, 1)) {
    problems.push(`toast: right edge ${toast.x + toast.w}, want ${island.x + island.w - TOAST.inset} (the editor island's less ${TOAST.inset})`);
  }
  if (!near(stack.y + stack.h, viewportHeight - TOAST.offset, 1)) problems.push(`toast: the stack ends at ${stack.y + stack.h}, want ${viewportHeight - TOAST.offset}`);
  return problems;
}

/** What {@link probeLitRim} read: the one lit island, and what the lit main island wears. */
export interface LitRim {
  readonly lit: string[];
  readonly wash: string | null;
  readonly tint: string | null;
  readonly drop: string | null;
}

/**
 * Read the lit island's light (the main island lit, as in the base scene): the
 * islands carrying `data-lit`, the main island's tab strip's image, its
 * breadcrumbs' image and the shadow on the bottom split's handle.
 */
export async function probeLitRim(page: Page): Promise<LitRim> {
  return page.evaluate(() => {
    const lit = [...document.querySelectorAll<HTMLElement>(".spexr-island[data-lit]")].map((el) => el.dataset["island"] ?? el.id);
    const image = (selector: string): string | null => {
      const el = document.querySelector<HTMLElement>(selector);
      return el ? getComputedStyle(el).backgroundImage : null;
    };
    const handle = document.querySelector<HTMLElement>("#theia-bottom-split-panel > .lm-SplitPanel-handle");
    return {
      lit,
      wash: image("#theia-main-content-panel .lm-TabBar .theia-tabBar-tab-row"),
      tint: image("#theia-main-content-panel .theia-tabBar-breadcrumb-row"),
      drop: handle ? getComputedStyle(handle).boxShadow : null,
    };
  });
}

/** Exactly one island lit, the main one, wearing the wash, the tint and the drop. */
export function checkLitRim(rim: LitRim): string[] {
  const problems: string[] = [];
  if (rim.lit.length !== 1) problems.push(`lit rim: ${rim.lit.length} islands lit (${rim.lit.join(", ")}), want exactly 1`);
  else if (rim.lit[0] !== "main") problems.push(`lit rim: the ${rim.lit[0]} island is lit, want main`);
  if (!rim.wash?.includes("radial-gradient")) problems.push(`lit rim: the tab strip has no wash (${rim.wash})`);
  if (!rim.tint?.includes("linear-gradient")) problems.push(`lit rim: the breadcrumbs have no tint (${rim.tint})`);
  if (!rim.drop || rim.drop === "none" || !rim.drop.includes("inset")) problems.push(`lit rim: no drop on the handle under the main island (${rim.drop})`);
  return problems;
}

type Rgb = [number, number, number];

/**
 * The colours of a saved screenshot at CSS points (x, y), read in the page:
 * the PNG is decoded with createImageBitmap, as scenes.ts does for its
 * comparison, and sampled at the page's device pixel ratio.
 */
export async function samplePixels(page: Page, file: string, points: ReadonlyArray<{ x: number; y: number }>): Promise<Rgb[]> {
  const png = (await import("fs")).readFileSync(file).toString("base64");
  return page.evaluate(
    async ({ png, points }) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(bitmap, 0, 0);
      const dpr = window.devicePixelRatio;
      return points.map(({ x, y }) => {
        const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
        return [d[0]!, d[1]!, d[2]!] as [number, number, number];
      });
    },
    { png, points: [...points] },
  );
}

/** WCAG 2 contrast of two sRGB colours (0-255 channels). */
function contrast(a: Rgb, b: Rgb): number {
  const lum = (c: Rgb): number => {
    const [r, g, bl] = c.map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)) as Rgb;
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Rows sampled along an overlay's left edge. */
const EDGE_ROWS = 5;

/**
 * Where to sample an overlay's left edge, at EDGE_ROWS rows spread around the
 * middle of its left side (8px apart, closer on a short box): first its 1px
 * edge, then the ground 6px outside it, then its own fill 3px inside it, each
 * as one run of EDGE_ROWS points. One pixel per colour read a glyph of the
 * terminal text behind the toast as the ground; {@link checkEdge} takes the
 * median of each run.
 */
export function edgePoints(box: { x: number; y: number; w: number; h: number }): Array<{ x: number; y: number }> {
  const mid = box.y + Math.min(box.h / 2, 24);
  const step = Math.max(0, Math.min(8, (box.h - 16) / 4));
  const ys = Array.from({ length: EDGE_ROWS }, (_, i) => mid + (i - (EDGE_ROWS - 1) / 2) * step);
  return [box.x - 1, box.x - 6, box.x + 3].flatMap((x) => ys.map((y) => ({ x, y })));
}

/** The per-channel median of a run of colours: a stray glyph pixel does not move it. */
function median(run: readonly Rgb[]): Rgb {
  const at = (ch: 0 | 1 | 2): number => {
    const v = run.map((c) => c[ch]).sort((x, y) => x - y);
    return v[Math.floor(v.length / 2)]!;
  };
  return [at(0), at(1), at(2)];
}

/**
 * The overlay's boundary, as painted: its edge at 3:1 against its own fill and
 * against the ground behind it (the owner's rule for boundaries). `samples` is
 * what {@link edgePoints} asked for: edge, ground and fill runs in that order,
 * each reduced to its median (a run of one is itself).
 */
export function checkEdge(scene: string, samples: readonly Rgb[]): string[] {
  const n = Math.floor(samples.length / 3);
  if (n === 0 || samples.length % 3 !== 0) return [`${scene}: no pixels sampled`];
  const [edge, ground, fill] = [0, 1, 2].map((i) => median(samples.slice(i * n, (i + 1) * n))) as [Rgb, Rgb, Rgb];
  const problems: string[] = [];
  const onFill = contrast(edge, fill);
  const onGround = contrast(edge, ground);
  if (onFill < 3) problems.push(`${scene}: the edge ${edge} reads ${onFill.toFixed(2)}:1 on its fill ${fill}, want 3`);
  if (onGround < 3) problems.push(`${scene}: the edge ${edge} reads ${onGround.toFixed(2)}:1 on the ground ${ground}, want 3`);
  return problems;
}

// ── S6b: the left island ─────────────────────────────────────────────────
// Lumen's Explorer island is 264px with the Explorer in front (the base
// scene), and the Explorer holds no Smart Search: it lives in the Search view
// (D6). Geometry: WORKBENCH / EXPLORER_ISLAND in workbench-geometry.ts.

const EXPLORER_ISLAND = 264;

/** What {@link probeLeftIsland} read. */
export interface LeftIsland {
  /** The left island's width, null when it is not laid out. */
  readonly width: number | null;
  /** The Explorer container is on screen. */
  readonly explorerShown: boolean;
  /** Smart Search widgets (id `spexr.view.smart-search`) inside the Explorer container. */
  readonly smartSearchInExplorer: number;
  /** The Explorer's visible section headers' texts, in order (hidden sections left out). */
  readonly sectionHeads: string[];
}

/** Read the left island's width and what the Explorer container holds. */
export async function probeLeftIsland(page: Page): Promise<LeftIsland> {
  return page.evaluate(() => {
    const r = document.querySelector<HTMLElement>('.spexr-island[data-island="left"]')?.getBoundingClientRect();
    const explorer = document.getElementById("explorer-view-container");
    const shown = !!explorer && explorer.getBoundingClientRect().width > 0;
    return {
      width: r && r.width > 0 ? r.width : null,
      explorerShown: shown,
      smartSearchInExplorer: explorer ? explorer.querySelectorAll('[id$="spexr.view.smart-search"], [id="spexr.view.smart-search"]').length : 0,
      sectionHeads: explorer
        ? [...explorer.querySelectorAll<HTMLElement>(".part:not(.lm-mod-hidden) > .theia-view-container-part-header .label")].filter((el) => el.getBoundingClientRect().height > 0).map((el) => el.textContent?.trim() ?? "")
        : [],
    };
  });
}

/** The Explorer in front: the island is 264 (1px either way), and no Smart Search sits in the Explorer. */
export function checkLeftIsland(island: LeftIsland): string[] {
  const problems: string[] = [];
  if (!island.explorerShown) problems.push("left island: the Explorer is not in front in the base scene");
  if (island.width === null) problems.push("left island: not laid out");
  else if (!near(island.width, EXPLORER_ISLAND, 1)) problems.push(`left island: ${island.width}px wide, want ${EXPLORER_ISLAND} (the Explorer in front)`);
  if (island.sectionHeads.length !== 1 || island.sectionHeads[0] !== "probe-engine") problems.push(`left island: the Explorer's visible section headers are [${island.sectionHeads.join(", ")}], want [probe-engine]`);
  if (island.smartSearchInExplorer !== 0) problems.push(`left island: ${island.smartSearchInExplorer} Smart Search widget(s) inside the Explorer, want none (it is in the Search view)`);
  return problems;
}

/** The left island's width in px (null when it is not laid out), the right island's and the bottom island's height. */
export async function islandSizes(page: Page): Promise<{ left: number | null; right: number | null; bottom: number | null }> {
  return page.evaluate(() => {
    const rect = (area: string): DOMRect | undefined => document.querySelector<HTMLElement>(`.spexr-island[data-island="${area}"]`)?.getBoundingClientRect();
    const size = (r: DOMRect | undefined, key: "width" | "height"): number | null => (r && r.width > 0 && r.height > 0 ? Math.round(r[key] * 10) / 10 : null);
    return { left: size(rect("left"), "width"), right: size(rect("right"), "width"), bottom: size(rect("bottom"), "height") };
  });
}

/**
 * Bring a view to the front of the left island through its activity tile
 * (`#shell-tab-<widget id>`), unless it already is (clicking the current tile
 * collapses the island), and wait until the tile is the current one.
 */
export async function showLeftView(page: Page, widgetId: string): Promise<void> {
  const tab = page.locator(`#shell-tab-${widgetId}`);
  await tab.waitFor({ state: "visible", timeout: 15_000 });
  if (!(await tab.evaluate((el) => el.classList.contains("lm-mod-current")))) await tab.click();
  await page.waitForFunction((id) => document.getElementById(`shell-tab-${id}`)?.classList.contains("lm-mod-current") === true, widgetId, { timeout: 10_000 });
}

/** Wait until the left island is `want` px wide (1px either way), and report what it is. */
export async function leftIslandIs(page: Page, want: number): Promise<number | null> {
  await page
    .waitForFunction(
      (w) => {
        const r = document.querySelector<HTMLElement>('.spexr-island[data-island="left"]')?.getBoundingClientRect();
        return !!r && Math.abs(r.width - w) <= 1;
      },
      want,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
  return (await islandSizes(page)).left;
}

/** The agent terminal in front is 432 and the Explorer 264, in both directions, and the right and bottom islands do not move. */
export function checkLeftViews(steps: ReadonlyArray<{ step: string; left: number | null; want: number }>, before: { right: number | null; bottom: number | null }, after: { right: number | null; bottom: number | null }): string[] {
  const problems: string[] = [];
  for (const { step, left, want } of steps) {
    if (left === null || !near(left, want, 1)) problems.push(`left views: ${step}: ${left ?? "not laid out"}px, want ${want}`);
  }
  for (const key of ["right", "bottom"] as const) {
    const a = before[key];
    const b = after[key];
    if (a === null || b === null || !near(a, b, 1)) problems.push(`left views: the ${key} island moved with the left view (${a} then ${b})`);
  }
  return problems;
}

// ── S6c: the editor strip ────────────────────────────────────────────────

/**
 * Scenes exempt from the aligned-strips check, and why. A fixture difference,
 * not a defect: the fixture's main strip holds the Welcome and Specs tabs,
 * which the demo's has not, so it overflows, and Theia scrolls it when the
 * island narrows (agent-front: the left island at 432) or when the right
 * island's views open over it (right-panel). Their counts are in the summary.
 * The base scene overflows too (by 64px at the capture's width, in the strip
 * probe's `overflow`) but needs no alignment scroll, because Theia has
 * already scrolled it to the current tab.
 */
const ALIGNED_STRIPS_EXEMPT: readonly string[] = ["right-panel", "agent-front"];

/**
 * The main tab strips need no help from the capture. The scenes' alignment
 * pass scrolls a strip so the current tab comes first; with the pinned tabs in
 * their places (Darkfactory trailing) a strip that stays put needs no scroll,
 * and one here means the strip moved on its own. Every scene is checked but
 * the exempt ones; a scene whose count is null (a crop, which never ran the
 * pass) is no evidence either way and is skipped.
 */
export function checkAlignedStrips(scenes: ReadonlyArray<{ scene: string; alignedStrips: number | null }>): string[] {
  return scenes
    .filter((s) => s.alignedStrips !== null && s.alignedStrips !== 0 && !ALIGNED_STRIPS_EXEMPT.includes(s.scene))
    .map((s) => `tab strip: scene ${s.scene} needed ${s.alignedStrips} alignment scroll(s), want 0`);
}

/**
 * The strip against the geometry table: a 36px strip with 28px tabs, 32px
 * breadcrumbs under it, no icon in any crumb, the meta at the row's end and
 * the Agents tab last. `strip` is the tab row and its tabs, `crumbs` the
 * breadcrumb row and its items, `meta` the meta's text and the box of its text (not of its padding).
 */
export interface EditorStrip {
  readonly row: Rect | null;
  readonly tabs: Rects;
  readonly crumbsRow: Rect | null;
  readonly crumbIcons: number;
  readonly meta: { text: string; box: Rect } | null;
  readonly tabIds: string[];
  /** How far the tabs overflow the strip (scrollWidth less clientWidth); 0 when they fit. Reported, not asserted: see {@link ALIGNED_STRIPS_EXEMPT}. */
  readonly overflow: number;
  /** Whether the current tab is cut off by the strip's edges. */
  readonly currentTabClipped: boolean;
}
type Rect = { x: number; y: number; w: number; h: number };

export function checkEditorStrip(strip: EditorStrip): string[] {
  const problems: string[] = [];
  if (!strip.row) return ["editor strip: no tab row"];
  if (!near(strip.row.h, 36, 1)) problems.push(`editor strip: tab row ${strip.row.h}px, want 36`);
  for (const [i, tab] of strip.tabs.entries()) if (!near(tab.h, 28, 1)) problems.push(`editor strip: tab ${i} is ${tab.h}px tall, want 28`);
  if (!strip.crumbsRow) problems.push("editor strip: no breadcrumb row");
  else if (!near(strip.crumbsRow.h, 32, 1)) problems.push(`editor strip: breadcrumb row ${strip.crumbsRow.h}px, want 32`);
  if (strip.crumbIcons !== 0) problems.push(`editor strip: ${strip.crumbIcons} breadcrumb icon(s), want none`);
  if (strip.meta && strip.crumbsRow && !near(strip.meta.box.x + strip.meta.box.w, strip.crumbsRow.x + strip.crumbsRow.w - 16, 2)) {
    problems.push(`editor strip: the meta ends at ${strip.meta.box.x + strip.meta.box.w}, want ${strip.crumbsRow.x + strip.crumbsRow.w - 16}`);
  }
  if (strip.currentTabClipped) problems.push("editor strip: the current tab is cut off by the strip's edge");
  const wall = strip.tabIds.indexOf("shell-tab-spexr.view.darkfactory");
  if (wall >= 0 && wall !== strip.tabIds.length - 1) problems.push(`editor strip: the Agents tab (Darkfactory) is ${wall + 1} of ${strip.tabIds.length}, want last`);
  return problems;
}

/** Read {@link EditorStrip} from the main island's first tab bar. */
export async function probeEditorStrip(page: Page): Promise<EditorStrip> {
  return page.evaluate(() => {
    const box = (el: Element | null): { x: number; y: number; w: number; h: number } | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const bar = document.querySelector("#theia-main-content-panel .lm-TabBar");
    const meta = bar?.querySelector(".spexr-breadcrumbs-meta") ?? null;
    const container = bar?.querySelector<HTMLElement>(".lm-TabBar-content-container") ?? null;
    const textBox = (el: Element): { x: number; y: number; w: number; h: number } => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      row: box(bar?.querySelector(".theia-tabBar-tab-row") ?? null),
      tabs: [...(bar?.querySelectorAll(".lm-TabBar-tab") ?? [])].map((t) => box(t)!).filter((b) => b.w > 0),
      crumbsRow: box(bar?.querySelector(".theia-tabBar-breadcrumb-row") ?? null),
      crumbIcons: bar?.querySelectorAll(".theia-breadcrumb-item > [class*='codicon'], .theia-breadcrumb-item > .file-icon").length ?? 0,
      meta: meta ? { text: meta.textContent ?? "", box: textBox(meta) } : null,
      tabIds: [...(bar?.querySelectorAll(".lm-TabBar-tab") ?? [])].map((t) => t.id),
      overflow: Math.max(0, (container?.scrollWidth ?? 0) - (container?.clientWidth ?? 0)),
      currentTabClipped: (() => {
        const current = bar?.querySelector(".lm-TabBar-tab.lm-mod-current")?.getBoundingClientRect();
        const edge = container?.getBoundingClientRect();
        return !!current && !!edge && (current.left < edge.left - 1 || current.right > edge.right + 1);
      })(),
    };
  });
}

// ── S6d: the activity bar and the status bar ─────────────────────────────

/** The left activity bar's tiles in the base scene, top to bottom (Lumen's order, D13). */
const ACTIVITY_TILES = ["explorer-view-container", "search-view-container", "scm-view-container", "spexr-claude", "test-view-container"];

/** Status entries (their ids without Theia's `status-bar-` prefix) that must not be on the bar, with the reason. */
const HIDDEN_STATUS = ["editor-status-tabbing-config", "editor-language-status-items", "bottom-panel-toggle", "spexr-project", "spexr-resources"];

/** The status bar entries Lumen's bar has, left to right on each side. */
const STATUS_LEFT = ["spexr-git-branch", "spexr-git-divergence", "spexr-git-sync", "problem-marker-status"];
const STATUS_RIGHT = ["editor-status-cursor-position", "editor-status-encoding", "editor-status-eol", "editor-status-language"];

/** What {@link probeActivityStatus} read. */
export interface ActivityStatus {
  /** The left activity bar's tabs' widget ids, top to bottom. */
  readonly tiles: string[];
  /** The status bar's entries' ids, left area then right area, in DOM order (the right area's left to right). */
  readonly left: string[];
  readonly right: string[];
}

/** Read the left activity bar's tiles and the status bar's entries as drawn (a hidden entry is not in the DOM). */
export async function probeActivityStatus(page: Page): Promise<ActivityStatus> {
  return page.evaluate(() => {
    const bars = [...document.querySelectorAll<HTMLElement>(".lm-TabBar.theia-app-sides")].filter((b) => b.getBoundingClientRect().x < 120);
    const tiles = [...(bars[0]?.querySelectorAll<HTMLElement>(".lm-TabBar-tab") ?? [])].filter((t) => t.getBoundingClientRect().width > 0).map((t) => t.id.replace(/^shell-tab-/, ""))
      .filter((id) => !id.endsWith("-hidden"));
    const ids = (area: string): string[] =>
      [...document.querySelectorAll<HTMLElement>(`#theia-statusBar .area.${area} > .element`)].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.id.replace(/^status-bar-/, ""));
    return { tiles, left: ids("left"), right: ids("right") };
  });
}

/** Whether `want` appears in `got` in that relative order (other entries between them are not this check's business). */
function inOrder(got: readonly string[], want: readonly string[]): boolean {
  const at = want.map((id) => got.indexOf(id));
  return at.every((i) => i >= 0) && at.every((i, k) => k === 0 || i > at[k - 1]!);
}

/**
 * The activity tiles are Explorer, Search, Source Control, Agent, Testing, and
 * nothing else (Debug and Extensions are off the default bar); the status
 * bar has Lumen's entries in Lumen's order and none of the hidden ones.
 */
export function checkActivityStatus(read: ActivityStatus): string[] {
  const problems: string[] = [];
  if (read.tiles.join(",") !== ACTIVITY_TILES.join(",")) problems.push(`activity bar: tiles [${read.tiles.join(", ")}], want [${ACTIVITY_TILES.join(", ")}]`);
  if (!inOrder(read.left, STATUS_LEFT)) problems.push(`status bar: left [${read.left.join(", ")}], want ${STATUS_LEFT.join(" < ")} in that order`);
  if (!inOrder(read.right, STATUS_RIGHT)) problems.push(`status bar: right [${read.right.join(", ")}], want ${STATUS_RIGHT.join(" < ")} in that order`);
  for (const id of HIDDEN_STATUS) if ([...read.left, ...read.right].includes(id)) problems.push(`status bar: ${id} is on the bar, want it hidden`);
  return problems;
}

// ── S6e: the bottom panel ────────────────────────────────────────────────

/** What {@link probeBottomPanel} read from the bottom island's first tab bar. */
export interface BottomPanel {
  readonly tabs: Array<{ id: string; label: string; severity: string | null }>;
  readonly strip: Rect | null;
  /** The Problems chip's box and computed radius, when it has a count. */
  readonly chip: { box: Rect; radius: string; severity: string | null } | null;
  /** The current tab's id: the "+" belongs to a terminal's toolbar only. */
  readonly current: string | null;
  /** Whether the toolbar holds a "+" and a close ×. */
  readonly plus: boolean;
  readonly close: boolean;
}

/** Read the bottom panel's tabs, its strip, the Problems chip and its buttons. */
export async function probeBottomPanel(page: Page): Promise<BottomPanel> {
  return page.evaluate(() => {
    const box = (el: Element | null): { x: number; y: number; w: number; h: number } | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const bar = document.querySelector("#theia-bottom-content-panel .lm-TabBar");
    const tabs = [...(bar?.querySelectorAll<HTMLElement>(".lm-TabBar-tab") ?? [])]
      .filter((t) => t.getBoundingClientRect().width > 0 && !t.id.endsWith("-hidden"))
      .map((t) => ({ id: t.id.replace(/^shell-tab-/, ""), label: t.querySelector(".lm-TabBar-tabLabel")?.textContent?.trim() ?? "", severity: t.getAttribute("data-severity") }));
    const problems = bar?.querySelector<HTMLElement>("#shell-tab-problems");
    const chipEl = problems?.querySelector<HTMLElement>(".theia-badge-decorator-horizontal") ?? null;
    return {
      tabs,
      current: bar?.querySelector(".lm-TabBar-tab.lm-mod-current")?.id.replace(/^shell-tab-/, "") ?? null,
      strip: box(bar?.querySelector(".theia-tabBar-tab-row") ?? bar ?? null),
      chip: chipEl ? { box: box(chipEl)!, radius: getComputedStyle(chipEl).borderTopLeftRadius, severity: problems?.getAttribute("data-severity") ?? null } : null,
      plus: !!bar?.querySelector(".lm-TabBar-toolbar .codicon-add"),
      close: !!bar?.querySelector(".lm-TabBar-toolbar .codicon-close"),
    };
  });
}

/**
 * The bottom panel: terminals first (titled "Terminal", "Terminal 2", ...),
 * then Problems, Output and the Agent log where it exists; a 36px strip; the
 * Problems chip 16px high at r6 with its severity marked; a "+" and a close ×.
 */
export function checkBottomPanel(panel: BottomPanel): string[] {
  const problems: string[] = [];
  const ids = panel.tabs.map((t) => t.id);
  const ordered = bottomOrder(ids);
  if (ids.join(",") !== ordered.join(",")) problems.push(`bottom panel: tabs [${ids.join(", ")}], want terminals, problems, outputView, agent log in that order`);
  for (const id of ["problems", "outputView"]) if (!ids.includes(id)) problems.push(`bottom panel: no ${id} tab`);
  const terminals = panel.tabs.filter((t) => t.id.startsWith("terminal-"));
  if (terminals.length === 0) problems.push("bottom panel: no terminal tab");
  terminals.forEach((t, i) => {
    const want = i === 0 ? "Terminal" : `Terminal ${i + 1}`;
    if (t.label !== want) problems.push(`bottom panel: terminal ${i + 1} is titled "${t.label}", want "${want}"`);
  });
  if (!panel.strip) problems.push("bottom panel: no tab strip");
  else if (!near(panel.strip.h, 36, 1)) problems.push(`bottom panel: tab strip ${panel.strip.h}px, want 36`);
  if (panel.chip) {
    if (!near(panel.chip.box.h, 16, 0.5)) problems.push(`bottom panel: the Problems chip is ${panel.chip.box.h}px high, want 16`);
    if (panel.chip.radius !== "6px") problems.push(`bottom panel: the Problems chip's radius is ${panel.chip.radius}, want 6px`);
    if (!panel.chip.severity) problems.push("bottom panel: the Problems tab carries no severity mark");
  }
  if (panel.current?.startsWith("terminal-") && !panel.plus) problems.push("bottom panel: a terminal is in front and there is no + button");
  if (!panel.close) problems.push("bottom panel: no close button");
  return problems;
}

// ── S6f: the outline icons ───────────────────────────────────────────────

/** What {@link probeOutlineIcons} read: each tab glyph's and label's vertical centres, and each folder row's glyph. */
export interface OutlineIcons {
  readonly tabs: Array<{ label: string; iconCentre: number; labelCentre: number }>;
  readonly folders: Array<{ expanded: boolean; glyph: string }>;
}

/** Read the main strip's tab glyphs against their labels, and the tree's folder glyphs (the computed `::before` content). */
export async function probeOutlineIcons(page: Page): Promise<OutlineIcons> {
  return page.evaluate(() => {
    const centre = (el: Element): number => {
      const r = el.getBoundingClientRect();
      return r.y + r.height / 2;
    };
    const tabs = [...document.querySelectorAll<HTMLElement>("#theia-main-content-panel .lm-TabBar-tab")]
      .map((tab) => ({ tab, icon: tab.querySelector(".lm-TabBar-tabIcon.spexr-outline-icon"), label: tab.querySelector(".lm-TabBar-tabLabel") }))
      .filter((t) => t.icon && t.label && t.tab.getBoundingClientRect().width > 0)
      .map((t) => ({ label: t.label!.textContent?.trim() ?? "", iconCentre: centre(t.icon!), labelCentre: centre(t.label!) }));
    const folders = [...document.querySelectorAll<HTMLElement>(".theia-TreeNode")]
      .map((row) => ({ row, icon: row.querySelector(".spexr-outline-icon--folder") }))
      .filter((r) => r.icon)
      .map((r) => ({
        expanded: !!r.row.querySelector(".theia-ExpansionToggle:not(.theia-mod-collapsed)"),
        glyph: getComputedStyle(r.icon!, "::before").content.replace(/^"|"$/g, ""),
      }));
    return { tabs, folders };
  });
}

/**
 * The tab glyph's centre is within 1px of its label's (it sat 3px high), and
 * every directory is the one closed folder, an expanded one included (the demo
 * draws no opened folder).
 */
export function checkOutlineIcons(icons: OutlineIcons): string[] {
  const problems: string[] = [];
  if (icons.tabs.length === 0) problems.push("outline icons: no tab with an outline glyph on screen");
  for (const t of icons.tabs) {
    if (Math.abs(t.iconCentre - t.labelCentre) > 1) problems.push(`outline icons: the glyph of tab "${t.label}" is centred ${(t.iconCentre - t.labelCentre).toFixed(1)}px off its label`);
  }
  if (!icons.folders.some((f) => f.expanded)) problems.push("outline icons: no expanded folder on screen to check");
  for (const f of icons.folders) {
    if (f.glyph !== OUTLINE_GLYPH.folder) problems.push(`outline icons: a ${f.expanded ? "expanded" : "collapsed"} folder draws ${JSON.stringify(f.glyph)}, want the closed folder ${JSON.stringify(OUTLINE_GLYPH.folder)}`);
  }
  return problems;
}
