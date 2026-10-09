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

/** Where to sample an overlay's left edge: its 1px edge, the ground 6px outside it, its own fill 3px inside, at the middle of its left side. */
export function edgePoints(box: { x: number; y: number; w: number; h: number }): Array<{ x: number; y: number }> {
  const y = box.y + Math.min(box.h / 2, 24);
  return [{ x: box.x - 1, y }, { x: box.x - 6, y }, { x: box.x + 3, y }];
}

/** The overlay's boundary, as painted: its edge at 3:1 against its own fill and against the ground behind it (the owner's rule for boundaries). */
export function checkEdge(scene: string, samples: readonly Rgb[]): string[] {
  const [edge, ground, fill] = samples;
  if (!edge || !ground || !fill) return [`${scene}: no pixels sampled`];
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
  // Expanded, the log outgrows the island and scrolls: its scrollbar (up to 12px) narrows every card.
  const cardWidth = expanded ? AGENT.cardWidth - 6 : AGENT.cardWidth;
  const cardTol = expanded ? 7 : 1;
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
    // Scrolled out of the island when expanded: its geometry is then not measured.
    if (!(expanded && !dcard) && (!dcard || !near(dcard.w, cardWidth, cardTol))) problems.push(`agent pane: diff card ${dcard?.w}px wide, want ${AGENT.cardWidth}`);
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
 * with its keycap, both disabled while the agent works, with "Agent is
 * working" shown; the focus ring only in the composer-focus scene.
 */
function checkComposer(state: AgentPaneState, regions: Regions, pane: Rects[number], focused: boolean): string[] {
  const problems: string[] = [];
  const c = state.composer;
  const box = regions["ap.composer"]?.[0];
  if (!c || !box) return ["agent pane: no composer"];
  const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
  if (!near(box.x - pane.x, 13, 1) || !near(box.w, 326, 1.5)) problems.push(`composer: at ${box.x - pane.x} in, ${box.w} wide, want 13 and 326 (the demo's 12 and 328, in the ring)`);
  if (!near(pane.y + pane.h - (box.y + box.h), 13, 1.5)) problems.push(`composer: ${pane.y + pane.h - (box.y + box.h)}px above the island's bottom edge, want 13`);
  // The demo's is 100.3. While the agent works a note line sits in it (S6i's security decision: Send is off, and says why): +24.
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
  // The audit's agent is mid-turn (a call is open): Send and Plan are off, and the composer says why. The demo's are on;
  // typing into a working Claude can answer a permission dialog with Enter, so they are not (S6i's security decision).
  if (c.planPressed || !c.planDisabled) problems.push(`composer: Plan pressed=${c.planPressed} disabled=${c.planDisabled}, want idle and disabled while the agent works`);
  if (!c.sendDisabled || !/^Send\s*\u23ce$/.test(c.sendText)) problems.push(`composer: Send disabled=${c.sendDisabled} text ${JSON.stringify(c.sendText)}, want disabled "Send \u23ce"`);
  if (c.note !== "Agent is working") problems.push(`composer: the note reads ${JSON.stringify(c.note)}, want "Agent is working"`);
  if (c.focused !== focused) problems.push(`composer: focus-within is ${c.focused}, want ${focused}`);
  return problems;
}
