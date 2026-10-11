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

/* ── S6h: the agent pane ────────────────────────────────────────────────── */

/** What the agent pane shows, read from the page's text and attributes. */
export interface AgentPaneState {
  readonly eyebrow: string | null;
  readonly title: string | null;
  readonly model: string | null;
  readonly prompt: string | null;
  readonly prose: string | null;
  readonly tools: ReadonlyArray<{ readonly text: string; readonly state: string | null; readonly meta: string }>;
  /** The fold's words (`7 earlier`: the same folded or expanded); null when there is no fold. */
  readonly fold: string | null;
  /** The fold as a control: a button a keyboard reaches, 24px at least, whose aria-expanded follows the card. */
  readonly foldButton: { readonly tag: string; readonly disabled: boolean; readonly tabIndex: number; readonly expanded: string | null; readonly height: number } | null;
  readonly diff: { readonly file: string; readonly stat: string; readonly rows: ReadonlyArray<{ readonly kind: "add" | "del"; readonly text: string }> } | null;
  readonly plan: ReadonlyArray<{ readonly text: string; readonly checked: boolean }>;
  readonly needsYou: boolean;
  readonly empty: boolean;
  /** The composer (S6i); null when the pane has none. */
  readonly composer: {
    readonly draft: string;
    readonly chip: { readonly text: string; readonly pressed: boolean } | null;
    readonly planPressed: boolean;
    readonly planDisabled: boolean;
    readonly sendDisabled: boolean;
    readonly sendText: string;
    /** The composer, the pane or neither holds focus: where the caret is. */
    readonly focused: boolean;
    readonly note: string | null;
  } | null;
}

/** Read the agent pane: its head, its prompt, its tool rows, its diff card and its plan. */
export async function probeAgentPane(page: Page): Promise<AgentPaneState> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#theia-right-content-panel .spexr-agent-pane");
    const text = (sel: string): string | null => (root?.querySelector(sel)?.textContent ?? null)?.replace(/\s+/g, " ").trim() ?? null;
    const diff = root?.querySelector(".spexr-agent-diff");
    return {
      eyebrow: text(".spexr-panel-head__eyebrow"),
      title: text(".spexr-panel-head__title"),
      model: text(".spexr-agent-pane__model"),
      prompt: text(".spexr-agent-prompt"),
      prose: text(".spexr-agent-prose"),
      tools: [...(root?.querySelectorAll(".spexr-agent-tool") ?? [])].map((row) => ({
        text: ((row.querySelector(".spexr-agent-tool__text")?.textContent ?? "") + (row.querySelector(".spexr-agent-stat")?.textContent ?? "")).replace(/\s+/g, " ").trim(),
        state: row.getAttribute("data-state"),
        meta: (row.querySelector(".spexr-agent-tool__meta")?.textContent ?? "").trim(),
      })),
      fold: text(".spexr-agent-tools__fold"),
      foldButton: (() => {
        const f = root?.querySelector<HTMLButtonElement>(".spexr-agent-tools__fold");
        return f ? { tag: f.tagName, disabled: f.disabled, tabIndex: f.tabIndex, expanded: f.getAttribute("aria-expanded"), height: Math.round(f.getBoundingClientRect().height * 100) / 100 } : null;
      })(),
      diff: diff
        ? {
            file: (diff.querySelector(".spexr-agent-diff__file")?.textContent ?? "").trim(),
            stat: (diff.querySelector(".spexr-agent-stat")?.textContent ?? "").replace(/\s+/g, " ").trim(),
            rows: [...diff.querySelectorAll(".spexr-agent-diff__row")].map((r) => ({
              kind: r.classList.contains("spexr-agent-diff__row--add") ? ("add" as const) : ("del" as const),
              text: r.textContent ?? "",
            })),
          }
        : null,
      plan: [...(root?.querySelectorAll(".spexr-agent-plan__item") ?? [])].map((label) => ({
        text: (label.querySelector(".sl-check__label")?.textContent ?? "").trim(),
        checked: (label.querySelector("input") as HTMLInputElement | null)?.checked === true,
      })),
      needsYou: !!root?.querySelector(".spexr-agent-needs"),
      empty: !!root?.classList.contains("spexr-agent-pane--empty"),
      composer: (() => {
        const c = root?.querySelector<HTMLElement>(".spexr-agent-composer");
        if (!c) return null;
        const chip = c.querySelector<HTMLElement>(".spexr-agent-composer__chip");
        const plan = c.querySelector<HTMLButtonElement>(".sl-btn--ghost");
        const send = c.querySelector<HTMLButtonElement>(".sl-btn--primary");
        return {
          draft: c.querySelector<HTMLTextAreaElement>("textarea")?.value ?? "",
          chip: chip ? { text: (chip.textContent ?? "").trim(), pressed: chip.getAttribute("aria-pressed") === "true" } : null,
          planPressed: plan?.getAttribute("aria-pressed") === "true",
          planDisabled: plan?.disabled === true,
          sendDisabled: send?.disabled === true,
          sendText: (send?.textContent ?? "").replace(/\s+/g, " ").trim(),
          focused: c.matches(":focus-within"),
          note: (c.querySelector(".spexr-agent-composer__note")?.textContent ?? "").trim() || null,
        };
      })(),
    };
  });
}

/**
 * The agent pane's geometry as the demo's (S6h), on the 4px grid: AGENT_PANE
 * and RIGHT_PANEL in workbench-geometry.ts. The check box is the kit's 18px
 * (kit 0.36.2), not the demo's 16: a kit part is reused as it is.
 */
const AGENT = { ring: 1, inline: 16, head: 69, headTol: 1.5, cardWidth: 318, row: 32, rowBorder: 1, check: 18, island: { x: 1030, w: 352 } };

/**
 * The agent pane against the demo's right pane (reference/demo-regions.json
 * `agent.*`, x 1082-1434), with "Refactor the audit" from the fixture in it.
 * spexr keeps its right activity bar, so the island sits 52px to the left, at
 * x 1030, and is 352 wide as the demo's; its 1px ring takes 1px off each side
 * of the demo's 320px cards, which are 318. The checks: a head of 69px (the
 * demo's 69.8) with the model tag 16px inside the ring; the prompt, tool and
 * diff cards 16px in; tool rows 32px (33 with the hairline above); exactly one
 * running; the +14 -3 edit; the plan's three checks, two of them checked. `expanded` is the tool card showing
 * every row (11) instead of the last four with "7 earlier".
 */
export function checkAgentPane(state: AgentPaneState, regions: Regions, expanded: boolean, focused = false): string[] {
  const problems: string[] = [];
  const pane = regions["ap.pane"]?.[0];
  if (!pane) return ["agent pane: the right island is not on screen"];
  if (state.empty) return ["agent pane: the pane is empty (no session was followed)"];
  const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
  // Expanded, or in a window the runner clamped (macos-15/26 displays are 1024x768: the island is 605px tall, not 828), the log outgrows the island and scrolls: its scrollbar (up to 12px) narrows every card.
  const scrolls = expanded || pane.h < 700;
  const cardWidth = scrolls ? AGENT.cardWidth - 6 : AGENT.cardWidth;
  const cardTol = scrolls ? 7 : 1;
  if (!near(pane.x, AGENT.island.x, 1) || !near(pane.w, AGENT.island.w, 1)) problems.push(`agent pane: the island is at x ${pane.x}, ${pane.w} wide, want ${AGENT.island.x} (the demo's 1082 less the right activity bar) and ${AGENT.island.w}`);

  const head = regions["ap.head"]?.[0];
  if (!head) problems.push("agent pane: no head");
  else {
    if (!near(head.h, AGENT.head, AGENT.headTol)) problems.push(`agent pane: head ${head.h}px, want ${AGENT.head}`);
    const title = regions["ap.title"]?.[0];
    if (title && !near(title.y - pane.y, 32 + AGENT.ring, 2)) problems.push(`agent pane: the title is ${title.y - pane.y}px from the top, want ${32 + AGENT.ring} (the demo's 32 and the ring)`);
  }
  if (!/^Agent · [0-9a-f]{6}$/i.test(state.eyebrow ?? "")) problems.push(`agent pane: eyebrow ${JSON.stringify(state.eyebrow)}, want "Agent · <6 characters>"`);
  if (state.title !== "Refactor the audit") problems.push(`agent pane: title ${JSON.stringify(state.title)}, want "Refactor the audit"`);
  if (state.model !== "Opus") problems.push(`agent pane: model tag ${JSON.stringify(state.model)}, want "Opus"`);
  const tag = regions["ap.model"]?.[0];
  if (!tag) problems.push("agent pane: no model tag");
  else if (!near(pane.x + pane.w - (tag.x + tag.w), AGENT.inline + AGENT.ring, 1.5)) problems.push(`agent pane: the model tag ends ${pane.x + pane.w - (tag.x + tag.w)}px from the right edge, want ${AGENT.inline + AGENT.ring}`);

  const prompt = regions["ap.prompt"]?.[0];
  if (!prompt) problems.push("agent pane: no prompt card");
  else if (!near(prompt.x - pane.x, AGENT.inline + AGENT.ring, 1) || !near(prompt.w, cardWidth, cardTol)) problems.push(`agent pane: prompt card at ${prompt.x - pane.x} in, ${prompt.w} wide, want ${AGENT.inline + AGENT.ring} and ${AGENT.cardWidth}`);
  if (!state.prompt?.startsWith("Make cache.write awaited")) problems.push(`agent pane: prompt ${JSON.stringify(state.prompt)}`);

  const want = expanded ? 11 : 4;
  if (state.tools.length !== want) problems.push(`agent pane: ${state.tools.length} tool rows, want ${want}`);
  if (state.fold !== "7 earlier") problems.push(`agent pane: the fold reads ${JSON.stringify(state.fold)}, want "7 earlier" (the same folded and expanded)`);
  const fb = state.foldButton;
  if (!fb || fb.tag !== "BUTTON" || fb.disabled || fb.tabIndex < 0) problems.push(`agent pane: the fold is not a button a keyboard reaches: ${JSON.stringify(fb)}`);
  else {
    if (fb.expanded !== String(expanded)) problems.push(`agent pane: the fold's aria-expanded is ${JSON.stringify(fb.expanded)}, want "${expanded}"`);
    if (fb.height < 24) problems.push(`agent pane: the fold is ${fb.height}px tall, want 24 at least`);
  }
  const running = state.tools.filter((t) => t.state === "run");
  if (running.length !== 1 || running[0]!.meta !== "running" || !/pnpm sl-audit/.test(running[0]!.text)) problems.push(`agent pane: running rows ${JSON.stringify(running)}, want one: pnpm sl-audit`);
  const edit = state.tools.find((t) => /^Edit resolve\.ts/.test(t.text));
  if (!edit || !/\+14 −3/.test(edit.text) || edit.meta !== "1.1 s") problems.push(`agent pane: the resolve.ts edit row is ${JSON.stringify(edit)}, want +14 −3 at 1.1 s`);
  const test = state.tools.find((t) => /pnpm test probe/.test(t.text));
  if (!test || test.meta !== "2.4 s" || test.state !== "done") problems.push(`agent pane: the pnpm test row is ${JSON.stringify(test)}, want done at 2.4 s`);

  const card = regions["ap.tools"]?.[0];
  if (!card) problems.push("agent pane: no tool card");
  else if (!near(card.x - pane.x, AGENT.inline + AGENT.ring, 1) || !near(card.w, cardWidth, cardTol)) problems.push(`agent pane: tool card at ${card.x - pane.x} in, ${card.w} wide, want ${AGENT.inline + AGENT.ring} and ${AGENT.cardWidth}`);
  for (const [i, row] of (regions["ap.tool"] ?? []).entries()) {
    const h = i === 0 ? AGENT.row : AGENT.row + AGENT.rowBorder;
    if (!near(row.h, h, 1)) problems.push(`agent pane: tool row ${i} is ${row.h}px tall, want ${h}`);
  }

  if (!state.diff) problems.push("agent pane: no diff card");
  else {
    if (state.diff.file !== "resolve.ts" || !/\+14 −3/.test(state.diff.stat)) problems.push(`agent pane: diff card ${state.diff.file} ${state.diff.stat}, want resolve.ts +14 −3`);
    if (state.diff.rows.length !== 6 || !state.diff.rows.slice(0, 3).every((r) => r.kind === "del") || !state.diff.rows.slice(3).every((r) => r.kind === "add")) {
      problems.push(`agent pane: diff rows ${state.diff.rows.map((r) => r.kind).join(",")}, want 3 removed then 3 added`);
    }
    const dcard = regions["ap.diff"]?.[0];
    // Scrolled out of the island when expanded or in a clamped window: its geometry is then not measured.
    if (!(scrolls && !dcard) && (!dcard || !near(dcard.w, cardWidth, cardTol))) problems.push(`agent pane: diff card ${dcard?.w}px wide, want ${AGENT.cardWidth}`);
  }

  if (state.plan.map((p) => p.checked).join() !== "true,true,false") problems.push(`agent pane: plan checks ${state.plan.map((p) => p.checked).join()}, want true,true,false`);
  if (state.plan.map((p) => p.text).join("|") !== "Await the write|Re-run the probe suite|Fix the R finding") problems.push(`agent pane: plan ${state.plan.map((p) => p.text).join("|")}`);
  for (const [i, box] of (regions["ap.check.box"] ?? []).entries()) {
    if (!near(box.w, AGENT.check, 1) || !near(box.h, AGENT.check, 1)) problems.push(`agent pane: check box ${i} is ${box.w}x${box.h}, want ${AGENT.check}`);
  }
  if (state.needsYou) problems.push("agent pane: a needs-you row shows, but the audit's agent is working");
  problems.push(...checkComposer(state, regions, pane, focused));
  return problems;
}

/** The demo's composer draft, which the capture puts in the field without focusing it. */
export const SEEDED_DRAFT = "Also fix the colour literal, then open a PR";

/**
 * The composer against the demo's (`agent.composer` 328 x 100.3 at 12px from
 * the island's edges, `agent.textarea`, `agent.chip` 24 high, the Plan and Send
 * buttons 24 high): 12px off the ring's inside, so 326 wide against the demo's
 * 328; the seeded draft; the chip `@resolve.ts` pressed; Plan idle and Send
 * with its keycap, both enabled and no note; the focus ring only in the
 * composer-focus scene.
 */
function checkComposer(state: AgentPaneState, regions: Regions, pane: Rects[number], focused: boolean): string[] {
  const problems: string[] = [];
  const c = state.composer;
  const box = regions["ap.composer"]?.[0];
  if (!c || !box) return ["agent pane: no composer"];
  const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
  if (!near(box.x - pane.x, 13, 1) || !near(box.w, 326, 1.5)) problems.push(`composer: at ${box.x - pane.x} in, ${box.w} wide, want 13 and 326 (the demo's 12 and 328, in the ring)`);
  if (!near(pane.y + pane.h - (box.y + box.h), 13, 1.5)) problems.push(`composer: ${pane.y + pane.h - (box.y + box.h)}px above the island's bottom edge, want 13`);
  // The demo's is 100.3. A note line (what was pasted, the shell-command hint) would add 24.
  const noted = c.note !== null;
  const [lo, hi] = noted ? [110, 128] : [90, 104];
  if (box.h < lo || box.h > hi) problems.push(`composer: ${box.h}px tall, want about the demo's 100 (${lo} to ${hi}${noted ? ", with its note" : ""})`);
  const field = regions["ap.field"]?.[0];
  if (!field || !near(field.x - box.x, 8, 1) || !near(field.w, box.w - 16, 1.5)) problems.push(`composer: the field is at ${field ? field.x - box.x : "?"} in, ${field?.w} wide, want 8 and ${box.w - 16}`);
  if (field && (field.h < 44 || field.h > 50)) problems.push(`composer: the field is ${field.h}px tall, want about the demo's 46.9 (44 to 50)`);
  if (c.draft !== SEEDED_DRAFT) problems.push(`composer: draft ${JSON.stringify(c.draft)}, want ${JSON.stringify(SEEDED_DRAFT)}`);
  if (!c.chip || c.chip.text !== "@resolve.ts" || !c.chip.pressed) problems.push(`composer: chip ${JSON.stringify(c.chip)}, want "@resolve.ts" pressed`);
  for (const key of ["ap.chip", "ap.planbtn", "ap.send"]) {
    const r = regions[key]?.[0];
    if (!r) problems.push(`composer: no ${key}`);
    else if (!near(r.h, 24, 1.5)) problems.push(`composer: ${key} is ${r.h}px tall, want the demo's 24`);
  }
  // Send and Plan are on, as the demo's are, whatever the audit's agent is doing: Send pastes without Enter and Plan only
  // brings the terminal forward, so neither is gated on the transcript (S6i's security decision). No note shows.
  if (c.planPressed || c.planDisabled) problems.push(`composer: Plan pressed=${c.planPressed} disabled=${c.planDisabled}, want idle and enabled (the agent runs; its footer shows no plan mode)`);
  if (c.sendDisabled || !/^Send\s*\u23ce$/.test(c.sendText)) problems.push(`composer: Send disabled=${c.sendDisabled} text ${JSON.stringify(c.sendText)}, want enabled "Send \u23ce" (the demo's)`);
  if (c.note !== null) problems.push(`composer: the note reads ${JSON.stringify(c.note)}, want none before anything is pasted`);
  if (c.focused !== focused) problems.push(`composer: focus-within is ${c.focused}, want ${focused}`);
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
  if (island.sectionHeads.join("|") !== "probe-engine|Sessions") problems.push(`left island: the Explorer's visible section headers are [${island.sectionHeads.join(", ")}], want [probe-engine, Sessions] (the workspace folder, then S6j's Sessions part)`);
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

/* ── S6j: sessions, the status items and the Agent log ──────────────────── */

/** What the Sessions part and the status bar's two agent items say, read from the page. */
export interface SessionsState {
  readonly rows: ReadonlyArray<{ readonly name: string; readonly meta: string; readonly selected: boolean; readonly tabStop: boolean }>;
  /** The pill's words; null when it is not drawn. */
  readonly pill: string | null;
  /** The model item's words; null when it is not drawn. */
  readonly model: string | null;
}

/** Read the Sessions rows, the agents pill and the model item. */
export async function probeSessions(page: Page): Promise<SessionsState> {
  return page.evaluate(() => {
    const words = (el: Element | null): string | null => (el ? (el.textContent ?? "").replace(/\s+/g, " ").trim() : null);
    return {
      rows: [...document.querySelectorAll<HTMLElement>(".spexr-sessions__row")].map((r) => ({
        name: words(r.querySelector(".spexr-sessions__name")) ?? "",
        meta: words(r.querySelector(".spexr-sessions__meta")) ?? "",
        selected: r.getAttribute("aria-selected") === "true",
        tabStop: r.tabIndex === 0,
      })),
      pill: words(document.getElementById("status-bar-spexr-agents-pill")),
      model: words(document.getElementById("status-bar-spexr-agent-model")),
    };
  });
}

/** The demo's three session rows (showcase/screens.js), as the fixture's sessions produce them. */
export const DEMO_SESSION_ROWS = [
  ["Refactor the audit", "running · 14 tools"],
  ["Prism light theme", "done · 1h · 212 tools"],
  ["Edge in shade", "done · 3h · 58 tools"],
] as const;

/** The demo's pill words: 14 + 198 tool calls over the two live agents. */
export const DEMO_AGENTS_PILL = "2 agents · 212 tools";

/**
 * The left island's Sessions part and the status bar's agent items against the
 * demo (reference/demo-regions.json `sessions.*`, `status.agents`,
 * `status.model`), on the 4px grid (SESSIONS, AGENTS_PILL in workbench-geometry.ts):
 * the three rows by their words, "Refactor the audit" selected, one tab stop; a
 * row 48px high (the demo's 46.38) and 48 apart (48.37), inset 8px in the part;
 * the pill reading 2 agents · 212 tools at the kit's 20px (the demo's 22), and the
 * model item reading Opus and a rate within the 500 tok/s cap (the demo's 1.2k is
 * not what Claude streams: the fixture says about 86), the two centred in the bar.
 */
export function checkSessions(state: SessionsState, regions: Regions): string[] {
  const problems: string[] = [];
  const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
  const got = state.rows.map((r) => [r.name, r.meta]);
  if (JSON.stringify(got) !== JSON.stringify(DEMO_SESSION_ROWS)) problems.push(`sessions: rows ${JSON.stringify(got)}, want ${JSON.stringify(DEMO_SESSION_ROWS)}`);
  const selected = state.rows.filter((r) => r.selected);
  if (selected.length !== 1 || selected[0]!.name !== "Refactor the audit") problems.push(`sessions: selected ${JSON.stringify(selected.map((r) => r.name))}, want only "Refactor the audit"`);
  if (state.rows.filter((r) => r.tabStop).length !== 1) problems.push("sessions: the list must have exactly one tab stop");

  const part = regions["sess.part"]?.[0];
  const rows = regions["sess.row"] ?? [];
  if (!part || rows.length !== state.rows.length) problems.push(`sessions: ${rows.length} of ${state.rows.length} rows are on screen (the part must show all three)`);
  else {
    for (const [i, r] of rows.entries()) {
      if (!near(r.h, 48, 2)) problems.push(`sessions: row ${i} is ${r.h}px tall, want 48 (the demo's 46.38)`);
      if (!near(r.x - part.x, 8, 1)) problems.push(`sessions: row ${i} is ${r.x - part.x}px in from the part, want 8 (the demo's 7.2)`);
      if (i > 0 && !near(r.y - rows[i - 1]!.y, 48, 1)) problems.push(`sessions: rows ${i - 1} and ${i} are ${r.y - rows[i - 1]!.y}px apart, want 48 (the demo's 48.37)`);
    }
    const names = regions["sess.name"] ?? [];
    const metas = regions["sess.meta"] ?? [];
    if (names[0] && metas[0] && !near(metas[0].y - names[0].y, 24, 1)) problems.push(`sessions: the meta sits ${metas[0].y - names[0].y}px under the name's top, want 24 (a 20px line and 4)`);
    if (metas[0] && !near(metas[0].h, 16, 1)) problems.push(`sessions: the meta line is ${metas[0].h}px, want 16`);
  }

  if (state.pill !== DEMO_AGENTS_PILL) problems.push(`status: the agents pill reads ${JSON.stringify(state.pill)}, want ${JSON.stringify(DEMO_AGENTS_PILL)}`);
  if (!/^Opus · \d{1,3} tok\/s$/.test(state.model ?? "")) problems.push(`status: the model item reads ${JSON.stringify(state.model)}, want "Opus · <n> tok/s"`);
  else if (Number(/\d+/.exec(state.model!)![0]) > 500) problems.push(`status: the model item reads ${state.model}, above the 500 tok/s cap`);
  const bar = regions["status.bar"]?.[0];
  for (const key of ["status.pill", "status.model"]) {
    const box = regions[key]?.[0];
    if (!box || !bar) {
      problems.push(`status: no ${key} box on screen`);
      continue;
    }
    if (!near(box.h, 20, 1)) problems.push(`status: ${key} is ${box.h}px tall, want 20 (the demo's 22)`);
    if (!near(box.y + box.h / 2, bar.y + bar.h / 2, 1.5)) problems.push(`status: ${key} is centred ${box.y + box.h / 2 - (bar.y + bar.h / 2)}px off the bar's middle`);
  }
  const pill = regions["status.pill"]?.[0];
  const model = regions["status.model"]?.[0];
  if (pill && model && pill.x + pill.w > model.x) problems.push("status: the pill and the model item overlap, or the model item is not to the right of the pill");
  return problems;
}

/** What the Agent log shows. */
export interface AgentLogState {
  /** The log's tab in the bottom panel is the current one. */
  readonly current: boolean;
  readonly lines: ReadonlyArray<{ readonly kind: string; readonly time: string | null; readonly text: string }>;
  /** The scroller's metrics: the log follows its end, so the last line is in view. */
  readonly scroller: { readonly overflowY: string; readonly scrollTop: number; readonly scrollHeight: number; readonly clientHeight: number; readonly lastLineInView: boolean } | null;
}

/** Read the Agent log's lines. */
export async function probeAgentLog(page: Page): Promise<AgentLogState> {
  return page.evaluate(() => ({
    scroller: (() => {
      const el = document.querySelector<HTMLElement>(".spexr-agent-log");
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const last = [...el.querySelectorAll<HTMLElement>(".spexr-df-term__line")].pop()?.getBoundingClientRect();
      return {
        overflowY: getComputedStyle(el).overflowY,
        scrollTop: Math.round(el.scrollTop),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        lastLineInView: !!last && last.bottom <= box.bottom + 1 && last.top >= box.top - 1,
      };
    })(),
    current: !!document.querySelector(".spexr-agent-log") && document.querySelector<HTMLElement>(".spexr-agent-log-widget")?.classList.contains("lm-mod-hidden") === false,
    lines: [...document.querySelectorAll<HTMLElement>(".spexr-agent-log .spexr-df-term__line")].map((l) => ({
      kind: l.getAttribute("data-kind") ?? "",
      time: (l.querySelector(".spexr-df-term__time")?.textContent ?? "").trim() || null,
      text: (l.querySelector(".spexr-df-term__text")?.textContent ?? "").replace(/\s+/g, " ").trim(),
    })),
  }));
}

/**
 * The Agent log of "Refactor the audit" (the fixture's agent): its events
 * with a clock time before each (the zone is the machine's, so the shape is
 * checked, not the hour), the prompt first, the running `pnpm sl-audit` call
 * among them; a 16px gutter, 20px lines at least, and the time column aligned.
 */
export function checkAgentLog(state: AgentLogState, regions: Regions): string[] {
  const problems: string[] = [];
  const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
  if (!state.current) problems.push("agent log: its tab is not the one in front");
  if (state.lines.length < 10) problems.push(`agent log: ${state.lines.length} lines, want 10 at least (the audit's calls and replies)`);
  const untimed = state.lines.filter((l) => !l.time || !/^\d{2}:\d{2}:\d{2}$/.test(l.time));
  if (untimed.length) problems.push(`agent log: ${untimed.length} line(s) without a clock time, the first: ${JSON.stringify(untimed[0])}`);
  const first = state.lines[0];
  if (first?.kind !== "prompt" || !first.text.startsWith("Make cache.write awaited")) problems.push(`agent log: the first line is ${JSON.stringify(first)}, want the prompt "Make cache.write awaited…"`);
  if (!state.lines.some((l) => l.kind === "tool" && /pnpm sl-audit/.test(l.text))) problems.push("agent log: no call line for pnpm sl-audit");
  for (const kind of ["prompt", "assistant", "tool", "result"]) {
    if (!state.lines.some((l) => l.kind === kind)) problems.push(`agent log: no ${kind} line`);
  }
  if (!state.scroller) problems.push("agent log: no scroller");
  else {
    if (state.scroller.overflowY !== "auto") problems.push(`agent log: the scroller's overflow-y is ${state.scroller.overflowY}, want auto`);
    if (!state.scroller.lastLineInView) problems.push(`agent log: the last line is not in view: ${JSON.stringify(state.scroller)} (the log follows its end)`);
  }
  const panel = regions["log.panel"]?.[0];
  const body = regions["log.body"]?.[0];
  const lines = regions["log.line"] ?? [];
  if (!panel || !body) problems.push("agent log: the log is not on screen");
  else {
    if (lines[0] && !near(lines[0].x - body.x, 16, 1)) problems.push(`agent log: the lines start ${lines[0].x - body.x}px in, want 16`);
    if (lines.some((l) => l.h < 19)) problems.push(`agent log: a line is ${Math.min(...lines.map((l) => l.h))}px tall, want 20 at least`);
  }
  const xs = (regions["log.time"] ?? []).map((t) => t.x);
  if (xs.length && Math.max(...xs) - Math.min(...xs) > 0.5) problems.push(`agent log: the time column is not aligned (x ${Math.min(...xs)} to ${Math.max(...xs)})`);
  return problems;
}

/* ── S6k: the inline diagnostic ─────────────────────────────────────────── */

/** The chips in the front editor, read from the page (computed styles, as drawn). */
export interface InlineDiagState {
  readonly chips: ReadonlyArray<{
    readonly text: string;
    readonly tone: "warning" | "error" | null;
    readonly fontSize: string;
    readonly fontFamily: string;
    readonly borderRadius: string;
    readonly paddingLeft: string;
    readonly paddingRight: string;
    readonly marginLeft: string;
    readonly color: string;
    /** The colour of the code on the same line, which the chip must not wear. */
    readonly editorColor: string;
    readonly background: string;
    readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
    /** The editor line (its number) the chip sits on, from the gutter row at the same height. */
    readonly line: number | null;
  }>;
}

/** Read the inline diagnostic chips of the visible editors. */
export async function probeInlineDiagnostics(page: Page): Promise<InlineDiagState> {
  return page.evaluate(() => {
    const chips = [...document.querySelectorAll<HTMLElement>(".spexr-inline-diag")].filter((el) => el.getBoundingClientRect().width > 0);
    return {
      chips: chips.map((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const editor = el.closest(".monaco-editor");
        const numbers = [...(editor?.querySelectorAll<HTMLElement>(".margin-view-overlays .line-numbers") ?? [])];
        const mid = r.top + r.height / 2;
        const row = numbers.find((n) => {
          const b = n.getBoundingClientRect();
          return mid >= b.top && mid <= b.bottom;
        });
        return {
          text: (el.textContent ?? "").replace(/\u00a0/g, " ").trim(),
          tone: el.classList.contains("spexr-inline-diag--warning") ? ("warning" as const) : el.classList.contains("spexr-inline-diag--error") ? ("error" as const) : null,
          fontSize: cs.fontSize,
          fontFamily: cs.fontFamily,
          borderRadius: cs.borderTopLeftRadius,
          paddingLeft: cs.paddingLeft,
          paddingRight: cs.paddingRight,
          marginLeft: cs.marginLeft,
          color: cs.color,
          editorColor: getComputedStyle(el.closest(".view-line") ?? document.body).color,
          background: cs.backgroundColor,
          rect: { x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 },
          line: row ? Number(row.textContent?.trim()) || null : null,
        };
      }),
    };
  });
}

/** The fixture's line 46 warning (the demo's "Promise returned is not awaited"). */
export const DEMO_DIAGNOSTIC = "Promise returned is not awaited";

/**
 * The inline diagnostic against the demo's `code.diag` (189.45 x 16, 24px after
 * line 46's code, Geist 12px, r5, padding 0 8, the warning on a 12% wash): one
 * chip, on line 46, in the warning tone, the sans at 12px with 8px of padding,
 * r4 (the grid's, for the demo's 5), 24px of margin, 16px high within 2px. Its
 * words are the demo's, or their start with an ellipsis: the first-launch
 * editor is narrower than the demo's, so the message is cut to the room the
 * line has left (inline-diagnostics.ts). The second warning (cache.ts) is in a
 * tab that is not showing, so it is not drawn.
 */
export function checkInlineDiagnostics(state: InlineDiagState): string[] {
  const problems: string[] = [];
  const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
  if (state.chips.length !== 1) return [`inline diagnostics: ${state.chips.length} chips on screen, want exactly 1 (line 46)`];
  const c = state.chips[0]!;
  const cut = c.text.endsWith("\u2026") && DEMO_DIAGNOSTIC.startsWith(c.text.slice(0, -1)) && c.text.length > 8;
  if (c.text !== DEMO_DIAGNOSTIC && !cut) problems.push(`inline diagnostics: the chip reads ${JSON.stringify(c.text)}, want ${JSON.stringify(DEMO_DIAGNOSTIC)} or its start with an ellipsis`);
  if (c.tone !== "warning") problems.push(`inline diagnostics: tone ${c.tone}, want warning`);
  if (c.line !== 46) problems.push(`inline diagnostics: the chip is on line ${c.line}, want 46`);
  if (c.fontSize !== "12px" || !/Geist|sans|system-ui/i.test(c.fontFamily)) problems.push(`inline diagnostics: font ${c.fontSize} ${c.fontFamily}, want the sans at 12px`);
  if (c.borderRadius !== "4px") problems.push(`inline diagnostics: radius ${c.borderRadius}, want 4px (the demo's 5 on the grid)`);
  if (c.paddingLeft !== "8px" || c.paddingRight !== "8px") problems.push(`inline diagnostics: padding ${c.paddingLeft} / ${c.paddingRight}, want 8px`);
  if (c.marginLeft !== "24px") problems.push(`inline diagnostics: margin ${c.marginLeft}, want 24px`);
  if (!near(c.rect.h, 16, 2)) problems.push(`inline diagnostics: the chip is ${c.rect.h}px tall, want 16 (the demo's)`);
  // Monaco's token colour sits on the same span: the chip's own text colour must win (the warning's, not the editor's).
  if (c.color === c.editorColor) problems.push(`inline diagnostics: the chip's text is the editor's colour ${c.color}, not the tone's`);
  if (c.background === "rgba(0, 0, 0, 0)" || c.background === "transparent") problems.push("inline diagnostics: the chip has no wash");
  return problems;
}
