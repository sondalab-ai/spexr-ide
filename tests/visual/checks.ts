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
      tint: image("#theia-main-content-panel .theia-breadcrumbs"),
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

/* ── S6a: the parity fixture loaded ─────────────────────────────────────── */

/** What the base scene shows of the fixture's content, read from the page. */
export interface FixtureState {
  /** `[data-parity="title.agents"]`'s text; null when the pill is not drawn. */
  readonly agentsPill: string | null;
  /** The bell carries its dot (`sl-titlebar__btn--dot`). */
  readonly bellDot: boolean;
  /** Toasts on screen: the base scene has the bell dot and no toast. */
  readonly toasts: number;
  /** The text of every editor tab carrying Theia's dirty class (`theia-mod-dirty`). */
  readonly dirtyTabs: readonly string[];
  /** The status bar's problem item (`#status-bar-problem-marker-status`) as errors and warnings; null when absent or unreadable. */
  readonly statusProblems: { readonly errors: number; readonly warnings: number } | null;
}

/** Read the pill, the bell, the toasts, the dirty tabs and the status bar's problem count. Cheap enough to poll while the backend's scan lands. */
export async function probeFixtureState(page: Page): Promise<FixtureState> {
  return page.evaluate(() => {
    const pill = document.querySelector<HTMLElement>('[data-parity="title.agents"]');
    const bell = document.querySelector<HTMLElement>('[data-parity="title.bell"]');
    const shown = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return {
      agentsPill: pill ? (pill.textContent ?? "").trim() : null,
      bellDot: !!bell && bell.classList.contains("sl-titlebar__btn--dot"),
      toasts: [...document.querySelectorAll(".theia-notification-list-item")].filter(shown).length,
      dirtyTabs: [...document.querySelectorAll<HTMLElement>(".lm-TabBar-tab.theia-mod-dirty")].map((t) => (t.textContent ?? "").trim()),
      statusProblems: (() => {
        const counts = (document.getElementById("status-bar-problem-marker-status")?.textContent ?? "").match(/\d+/g);
        return counts && counts.length >= 2 ? { errors: Number(counts[0]), warnings: Number(counts[1]) } : null;
      })(),
    };
  });
}

/** The fixture extension's and the pnpm stub's own report, as the capture read it. */
export interface FixtureReport {
  /** The parity driver's base acknowledgement: `fixture.problems`, `fixture.dirty`. */
  readonly base?: { readonly problems?: number; readonly dirty?: readonly string[] };
  /** The exit codes the `pnpm` stub recorded, by script. */
  readonly pnpm: Readonly<Record<string, number | undefined>>;
  /** Stub pids the scanner would count: `ps` lines whose command is `claude`, and their cwds. */
  readonly processes?: { readonly pids: readonly number[]; readonly psClaude: readonly string[]; readonly cwd: Readonly<Record<string, string | null>>; readonly dirs: readonly string[] };
}

/**
 * The fixture is what the demo shows (S6a): two agents running (the title
 * pill, which needs both stubs seen by the scanner and both transcripts
 * classified as working), the bell with its dot and no toast, two warnings,
 * resolve.ts and evidence.ts unsaved, and the shell terminal having run
 * `pnpm test probe` (exit 0) and `pnpm sl-audit` (exit 1). The terminal's
 * canvas cannot be read, so the two commands are known by the stub's records.
 */
export function checkFixture(state: FixtureState, report: FixtureReport): string[] {
  const problems: string[] = [];
  if (state.agentsPill !== "2 agents running") problems.push(`fixture: the agents pill reads ${JSON.stringify(state.agentsPill)}, want "2 agents running"`);
  if (!state.bellDot) problems.push("fixture: the bell has no dot (no notification in the centre)");
  if (state.toasts !== 0) problems.push(`fixture: ${state.toasts} toast(s) over the base scene, want none`);
  if (state.statusProblems?.warnings !== 2) problems.push(`fixture: the status bar shows ${JSON.stringify(state.statusProblems)}, want 2 warnings`);
  for (const file of ["resolve.ts", "evidence.ts"]) {
    if (!state.dirtyTabs.some((t) => t.includes(file))) problems.push(`fixture: no tab for ${file} carries the dirty class (dirty tabs: ${state.dirtyTabs.join(" | ") || "none"})`);
  }
  if (report.base?.problems !== 2) problems.push(`fixture: ${report.base?.problems} problems, want 2 (the demo's warning count)`);
  for (const file of ["resolve.ts", "evidence.ts"]) {
    if (!report.base?.dirty?.includes(file)) problems.push(`fixture: ${file} is not unsaved (dirty: ${(report.base?.dirty ?? []).join(", ") || "none"})`);
  }
  if (report.pnpm["test-probe"] !== 0) problems.push(`fixture: pnpm test probe recorded exit ${report.pnpm["test-probe"]}, want 0`);
  if (report.pnpm["sl-audit"] !== 1) problems.push(`fixture: pnpm sl-audit recorded exit ${report.pnpm["sl-audit"]}, want 1`);
  const proc = report.processes;
  if (!proc) problems.push("fixture: no process probe");
  else {
    for (const pid of proc.pids) {
      if (!proc.psClaude.some((l) => l.startsWith(`${pid} `))) problems.push(`fixture: ps does not list stub ${pid} as claude`);
    }
    for (const dir of proc.dirs) {
      if (!Object.values(proc.cwd).includes(dir)) problems.push(`fixture: no stub has cwd ${dir} (lsof: ${JSON.stringify(proc.cwd)})`);
    }
  }
  return problems;
}
