import { CLAUDE_TERMINAL_ID } from "../agent/claude-terminal-id.js";
import { ACTIVITY_COLUMN, AGENT_ISLAND, EXPLORER_ISLAND, areaSize } from "./workbench-geometry.js";

/**
 * The left island's width follows the view in front (S6b, D2): the agent
 * terminal's 432px, Lumen's Explorer 264px, and whatever the user dragged a
 * view to is remembered for that view. The widths here are island widths
 * (px); Theia's own size for the side adds the activity column
 * (`areaSize("left", island)`).
 */
export type LeftWidths = Readonly<Record<string, number>>;

/** Where the widths are kept between launches (Theia's `StorageService`). */
export const LEFT_WIDTHS_STORAGE_KEY = "spexr.leftIsland.widths";

/** The narrowest island worth remembering: below it a drag was a mis-drop, not a choice. */
export const MIN_REMEMBERED_ISLAND = 160;

/** The island a view opens at when it has no remembered width: the agent terminal's 432px, any other view's 264px. */
export function defaultLeftIsland(viewId: string): number {
  return viewId === CLAUDE_TERMINAL_ID ? AGENT_ISLAND : EXPLORER_ISLAND;
}

/** The island width for a view: its remembered one, or its default; the agent terminal never below its 432px floor. */
export function leftIslandFor(viewId: string, widths: LeftWidths): number {
  const remembered = widths[viewId];
  const width = typeof remembered === "number" && Number.isFinite(remembered) && remembered >= MIN_REMEMBERED_ISLAND ? remembered : defaultLeftIsland(viewId);
  return viewId === CLAUDE_TERMINAL_ID ? Math.max(width, AGENT_ISLAND) : width;
}

/** Theia's size for the side when a view is in front: the number `SidePanelHandler.resize` takes. */
export function leftPanelSizeFor(viewId: string, widths: LeftWidths): number {
  return areaSize("left", leftIslandFor(viewId, widths));
}

/**
 * The widths with `viewId`'s island taken from Theia's side size, which is
 * the island and the activity column. A size that is missing, or too narrow
 * to be a choice, leaves the widths as they were.
 */
export function rememberLeftWidth(widths: LeftWidths, viewId: string, panelSize: number | undefined): LeftWidths {
  if (panelSize === undefined || !Number.isFinite(panelSize)) return widths;
  const island = Math.round(panelSize - ACTIVITY_COLUMN);
  if (island < MIN_REMEMBERED_ISLAND || widths[viewId] === island) return widths;
  return { ...widths, [viewId]: island };
}

/** Widths read back from storage: only finite numbers under string keys survive, anything else is dropped. */
export function parseLeftWidths(raw: unknown): LeftWidths {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const widths: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value) && value >= MIN_REMEMBERED_ISLAND) widths[id] = Math.round(value);
  }
  return widths;
}

/** A Lumino title, as far as the controller reads it. */
export interface LeftTitleLike {
  readonly owner: { readonly id: string };
}

/** The part of Theia's `SidePanelHandler` (left) the controller touches; structural, so a fake tests it. */
export interface LeftPanelLike {
  readonly tabBar: {
    readonly currentTitle: LeftTitleLike | null;
    readonly currentChanged: {
      connect(slot: (sender: unknown, args: { previousTitle: LeftTitleLike | null; currentTitle: LeftTitleLike | null }) => void): boolean;
      disconnect(slot: (sender: unknown, args: { previousTitle: LeftTitleLike | null; currentTitle: LeftTitleLike | null }) => void): boolean;
    };
  };
  readonly state: { readonly expansion: string; readonly lastPanelSize?: number; readonly pendingUpdate?: Promise<unknown> };
  getPanelSize(): number | undefined;
  resize(size: number): void;
}

/** Where the widths live. */
export interface LeftWidthStore {
  load(): Promise<unknown>;
  save(widths: LeftWidths): Promise<void>;
}

type ChangedSlot = Parameters<LeftPanelLike["tabBar"]["currentChanged"]["connect"]>[0];

/**
 * Applies the width policy to the live left panel.
 *
 * - {@link attach} runs once the layout has settled (the default layout's
 *   mark): it loads the remembered widths, takes the view then in front as it
 *   is (its width is the restored or seeded one), and starts listening.
 *   Attached earlier it would remember the seeded 432px as the Explorer's,
 *   because startup reveals the Explorer before the agent terminal comes in front.
 * - A view change records the outgoing view's width, then sizes the panel for
 *   the incoming one, after Theia's pending panel update. A panel being
 *   collapsed (no incoming view) is recorded and left alone; Theia keeps the
 *   size for its next opening, which the next change then settles.
 * - {@link flush} records the view in front, for a window that is closing.
 * - {@link clear} forgets every width (Reset Layout).
 *
 * Nothing here throws into Theia: a storage fault costs the memory, not the layout.
 */
export class LeftIslandWidth {
  private widths: LeftWidths = {};
  private attached = false;
  private pending = 0;
  private queue: Promise<void> = Promise.resolve();

  /**
   * @param panel The left side panel handler.
   * @param store Where the widths are kept.
   * @param warn  Where a fault is reported.
   */
  constructor(
    private readonly panel: LeftPanelLike,
    private readonly store: LeftWidthStore,
    private readonly warn: (message: string, ...detail: unknown[]) => void = () => undefined,
  ) {}

  private readonly onChanged: ChangedSlot = (_sender, args) => {
    const outgoing = args.previousTitle?.owner.id;
    const incoming = args.currentTitle?.owner.id;
    if (outgoing) this.remember(outgoing);
    if (!incoming) return;
    this.pending++;
    this.queue = this.queue
      .then(() => this.size(incoming))
      .catch((err: unknown) => this.warn("[spexr] the left island's width could not be set", err))
      .finally(() => {
        this.pending--;
      });
  };

  /** Load the remembered widths, take the view in front as it is, and start following the panel. */
  async attach(): Promise<void> {
    if (this.attached) return;
    this.attached = true;
    try {
      this.widths = parseLeftWidths(await this.store.load());
    } catch (err) {
      this.warn("[spexr] the left island's remembered widths could not be read", err);
    }
    this.flush();
    this.panel.tabBar.currentChanged.connect(this.onChanged);
  }

  /** Stop following the panel. */
  detach(): void {
    this.panel.tabBar.currentChanged.disconnect(this.onChanged);
    this.attached = false;
  }

  /** Record the width of the view in front (a closing window; the settled layout). */
  flush(): void {
    const current = this.panel.tabBar.currentTitle?.owner.id;
    if (current) this.remember(current);
  }

  /** Forget every remembered width: the views open at their defaults again. */
  async clear(): Promise<void> {
    this.widths = {};
    try {
      await this.store.save(this.widths);
    } catch (err) {
      this.warn("[spexr] the left island's remembered widths could not be cleared", err);
    }
  }

  /** The widths as remembered now. */
  get remembered(): LeftWidths {
    return this.widths;
  }

  private remember(viewId: string): void {
    // A change still being applied leaves the panel at another view's width.
    if (this.pending > 0) return;
    const { expansion, lastPanelSize } = this.panel.state;
    const size = expansion === "expanded" ? this.panel.getPanelSize() : expansion === "collapsed" ? lastPanelSize : undefined;
    const next = rememberLeftWidth(this.widths, viewId, size);
    if (next === this.widths) return;
    this.widths = next;
    void this.store.save(next).catch((err: unknown) => this.warn("[spexr] the left island's widths could not be saved", err));
  }

  private async size(viewId: string): Promise<void> {
    await this.panel.state.pendingUpdate;
    this.panel.resize(leftPanelSizeFor(viewId, this.widths));
  }
}
