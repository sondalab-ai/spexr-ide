import { describe, expect, it } from "vitest";
import { CLAUDE_TERMINAL_ID } from "../agent/claude-terminal-id.js";
import {
  LeftIslandWidth,
  MIN_REMEMBERED_ISLAND,
  defaultLeftIsland,
  leftIslandFor,
  leftPanelSizeFor,
  parseLeftWidths,
  rememberLeftWidth,
  type LeftPanelLike,
  type LeftWidthStore,
} from "./left-island-width.js";
import { ACTIVITY_COLUMN, AGENT_ISLAND, EXPLORER_ISLAND } from "./workbench-geometry.js";

const EXPLORER = "explorer-view-container";
const SEARCH = "search-view-container";

describe("the left island's width policy", () => {
  it("is 432 for the agent terminal and 264 for any other view, with nothing remembered", () => {
    expect(defaultLeftIsland(CLAUDE_TERMINAL_ID)).toBe(432);
    expect(defaultLeftIsland(EXPLORER)).toBe(264);
    expect(defaultLeftIsland(SEARCH)).toBe(264);
    expect(AGENT_ISLAND).toBe(432);
    expect(EXPLORER_ISLAND).toBe(264);
    expect(leftIslandFor(CLAUDE_TERMINAL_ID, {})).toBe(432);
    expect(leftIslandFor(EXPLORER, {})).toBe(264);
  });

  it("gives a view its remembered width, so the Explorer can be wider than 264", () => {
    expect(leftIslandFor(EXPLORER, { [EXPLORER]: 320 })).toBe(320);
    expect(leftIslandFor(EXPLORER, { [CLAUDE_TERMINAL_ID]: 600 })).toBe(264);
    expect(leftIslandFor(CLAUDE_TERMINAL_ID, { [CLAUDE_TERMINAL_ID]: 532 })).toBe(532);
  });

  it("never takes the agent terminal below its 432 floor, but lets the Explorer go narrower than 264", () => {
    expect(leftIslandFor(CLAUDE_TERMINAL_ID, { [CLAUDE_TERMINAL_ID]: 200 })).toBe(432);
    expect(leftIslandFor(EXPLORER, { [EXPLORER]: 200 })).toBe(200);
  });

  it("ignores a remembered width that is not a width: too narrow, not finite, not a number", () => {
    expect(leftIslandFor(EXPLORER, { [EXPLORER]: MIN_REMEMBERED_ISLAND - 1 })).toBe(264);
    expect(leftIslandFor(EXPLORER, { [EXPLORER]: Number.NaN })).toBe(264);
    expect(leftIslandFor(EXPLORER, { [EXPLORER]: Infinity })).toBe(264);
    expect(leftIslandFor(EXPLORER, JSON.parse('{"explorer-view-container":"wide"}') as Record<string, number>)).toBe(264);
  });

  it("is Theia's size with the activity column added", () => {
    expect(leftPanelSizeFor(EXPLORER, {})).toBe(ACTIVITY_COLUMN + 264);
    expect(leftPanelSizeFor(CLAUDE_TERMINAL_ID, {})).toBe(ACTIVITY_COLUMN + 432);
  });

  it("remembers an island from Theia's size, less the activity column, rounded", () => {
    expect(rememberLeftWidth({}, EXPLORER, ACTIVITY_COLUMN + 300)).toEqual({ [EXPLORER]: 300 });
    expect(rememberLeftWidth({}, EXPLORER, ACTIVITY_COLUMN + 300.4)).toEqual({ [EXPLORER]: 300 });
    expect(rememberLeftWidth({ [SEARCH]: 280 }, EXPLORER, ACTIVITY_COLUMN + 300)).toEqual({ [SEARCH]: 280, [EXPLORER]: 300 });
  });

  it("keeps the same object when nothing changes, and for a size that is missing or too narrow", () => {
    const widths = { [EXPLORER]: 300 };
    expect(rememberLeftWidth(widths, EXPLORER, ACTIVITY_COLUMN + 300)).toBe(widths);
    expect(rememberLeftWidth(widths, EXPLORER, undefined)).toBe(widths);
    expect(rememberLeftWidth(widths, EXPLORER, Number.NaN)).toBe(widths);
    expect(rememberLeftWidth(widths, EXPLORER, ACTIVITY_COLUMN + 10)).toBe(widths);
  });

  it("reads widths back from storage, dropping what is not a width", () => {
    expect(parseLeftWidths({ a: 300, b: "x", c: Number.NaN, d: 10, e: 280.6 })).toEqual({ a: 300, e: 281 });
    expect(parseLeftWidths(undefined)).toEqual({});
    expect(parseLeftWidths(null)).toEqual({});
    expect(parseLeftWidths([300])).toEqual({});
    expect(parseLeftWidths("300")).toEqual({});
  });
});

type Slot = (sender: unknown, args: { previousTitle: { owner: { id: string } } | null; currentTitle: { owner: { id: string } } | null }) => void;

/** A left panel that is as wide as the last resize, with the view in front its tab bar's current title. */
class FakePanel implements LeftPanelLike {
  slots: Slot[] = [];
  current: string | null;
  size: number | undefined;
  expansion = "expanded";
  lastPanelSize: number | undefined;
  resizes: number[] = [];
  pendingUpdate: Promise<unknown> = Promise.resolve();

  constructor(current: string | null, size: number) {
    this.current = current;
    this.size = size;
  }

  get tabBar(): LeftPanelLike["tabBar"] {
    const panel = this;
    return {
      get currentTitle() {
        return panel.current ? { owner: { id: panel.current } } : null;
      },
      currentChanged: {
        connect: (slot) => {
          panel.slots.push(slot as Slot);
          return true;
        },
        disconnect: (slot) => {
          panel.slots = panel.slots.filter((s) => s !== slot);
          return true;
        },
      },
    };
  }

  get state(): LeftPanelLike["state"] {
    return { expansion: this.expansion, lastPanelSize: this.lastPanelSize, pendingUpdate: this.pendingUpdate };
  }

  getPanelSize(): number | undefined {
    return this.expansion === "expanded" ? this.size : undefined;
  }

  resize(size: number): void {
    this.resizes.push(size);
    this.size = size;
  }

  /** What Theia does: the tab bar changes its current title, and the handlers connected run. */
  show(id: string | null): void {
    const previous = this.current;
    if (id === null) {
      this.lastPanelSize = this.size;
      this.expansion = "collapsed";
    } else this.expansion = "expanded";
    this.current = id;
    for (const slot of [...this.slots]) slot(undefined, { previousTitle: previous ? { owner: { id: previous } } : null, currentTitle: id ? { owner: { id } } : null });
  }
}

/** A store that keeps what it is given in memory. */
function memoryStore(initial: unknown = undefined): LeftWidthStore & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    load: () => Promise.resolve(initial),
    save: (widths) => {
      saved.push(widths);
      return Promise.resolve();
    },
  };
}

/** Let the controller's queued resizes run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("the left island's width controller", () => {
  it("takes the Explorer to 264 when it comes in front of the agent terminal, and back to 432", async () => {
    const panel = new FakePanel(CLAUDE_TERMINAL_ID, ACTIVITY_COLUMN + 432);
    const widths = new LeftIslandWidth(panel, memoryStore());
    await widths.attach();
    panel.show(EXPLORER);
    await settle();
    expect(panel.size).toBe(ACTIVITY_COLUMN + 264);
    panel.show(CLAUDE_TERMINAL_ID);
    await settle();
    expect(panel.size).toBe(ACTIVITY_COLUMN + 432);
  });

  it("remembers a width the user chose for a view, and gives it back when the view returns", async () => {
    const panel = new FakePanel(CLAUDE_TERMINAL_ID, ACTIVITY_COLUMN + 432);
    const store = memoryStore();
    const widths = new LeftIslandWidth(panel, store);
    await widths.attach();
    panel.size = ACTIVITY_COLUMN + 532;
    panel.show(EXPLORER);
    await settle();
    expect(panel.size).toBe(ACTIVITY_COLUMN + 264);
    panel.size = ACTIVITY_COLUMN + 300;
    panel.show(CLAUDE_TERMINAL_ID);
    await settle();
    expect(panel.size).toBe(ACTIVITY_COLUMN + 532);
    panel.show(EXPLORER);
    await settle();
    expect(panel.size).toBe(ACTIVITY_COLUMN + 300);
    expect(widths.remembered).toEqual({ [CLAUDE_TERMINAL_ID]: 532, [EXPLORER]: 300 });
    expect(store.saved.length).toBeGreaterThan(0);
  });

  it("starts from the widths in storage", async () => {
    const panel = new FakePanel(CLAUDE_TERMINAL_ID, ACTIVITY_COLUMN + 432);
    const widths = new LeftIslandWidth(panel, memoryStore({ [EXPLORER]: 320 }));
    await widths.attach();
    panel.show(EXPLORER);
    await settle();
    expect(panel.size).toBe(ACTIVITY_COLUMN + 320);
  });

  it("does not resize the view that is in front when it attaches: the layout's own width stays", async () => {
    const panel = new FakePanel(CLAUDE_TERMINAL_ID, ACTIVITY_COLUMN + 532);
    const widths = new LeftIslandWidth(panel, memoryStore());
    await widths.attach();
    expect(panel.resizes).toEqual([]);
    expect(widths.remembered).toEqual({ [CLAUDE_TERMINAL_ID]: 532 });
  });

  it("never shrinks a width that was remembered, 432 included, through any number of switches", async () => {
    const panel = new FakePanel(CLAUDE_TERMINAL_ID, ACTIVITY_COLUMN + 432);
    const widths = new LeftIslandWidth(panel, memoryStore({ [EXPLORER]: 432 }));
    await widths.attach();
    for (const view of [EXPLORER, SEARCH, EXPLORER, CLAUDE_TERMINAL_ID, EXPLORER]) {
      panel.show(view);
      await settle();
    }
    expect(panel.size).toBe(ACTIVITY_COLUMN + 432);
    expect(widths.remembered[EXPLORER]).toBe(432);
    expect(leftIslandFor(EXPLORER, { [EXPLORER]: 432 })).toBe(432);
  });

  it("takes a view other than the agent terminal, left at the seeded 432, to its default when it attaches, and does not remember the 432", async () => {
    const panel = new FakePanel(EXPLORER, ACTIVITY_COLUMN + 432);
    const widths = new LeftIslandWidth(panel, memoryStore());
    await widths.attach();
    expect(panel.resizes).toEqual([ACTIVITY_COLUMN + 264]);
    expect(widths.remembered).toEqual({});
  });

  it("leaves the agent terminal at 432, and a restored Explorer at its own width, when it attaches", async () => {
    const agent = new FakePanel(CLAUDE_TERMINAL_ID, ACTIVITY_COLUMN + 432);
    await new LeftIslandWidth(agent, memoryStore()).attach();
    expect(agent.resizes).toEqual([]);
    const explorer = new FakePanel(EXPLORER, ACTIVITY_COLUMN + 300);
    await new LeftIslandWidth(explorer, memoryStore()).attach();
    expect(explorer.resizes).toEqual([]);
    const remembered = new FakePanel(EXPLORER, ACTIVITY_COLUMN + 432);
    await new LeftIslandWidth(remembered, memoryStore({ [EXPLORER]: 432 })).attach();
    expect(remembered.resizes).toEqual([]);
  });

  it("records the view in front when the panel collapses, from the size Theia kept, and leaves the panel alone", async () => {
    const panel = new FakePanel(EXPLORER, ACTIVITY_COLUMN + 300);
    const widths = new LeftIslandWidth(panel, memoryStore());
    await widths.attach();
    panel.show(null);
    await settle();
    expect(panel.resizes).toEqual([]);
    expect(widths.remembered).toEqual({ [EXPLORER]: 300 });
    panel.show(CLAUDE_TERMINAL_ID);
    await settle();
    expect(panel.size).toBe(ACTIVITY_COLUMN + 432);
  });

  it("forgets everything on clear, so the views open at their defaults again", async () => {
    const panel = new FakePanel(EXPLORER, ACTIVITY_COLUMN + 300);
    const widths = new LeftIslandWidth(panel, memoryStore());
    await widths.attach();
    await widths.clear();
    expect(widths.remembered).toEqual({});
    // Reset Layout sizes the panel itself, right after.
    panel.size = ACTIVITY_COLUMN + 264;
    panel.show(SEARCH);
    await settle();
    panel.show(EXPLORER);
    await settle();
    expect(panel.size).toBe(ACTIVITY_COLUMN + 264);
  });

  it("stops following the panel on detach", async () => {
    const panel = new FakePanel(CLAUDE_TERMINAL_ID, ACTIVITY_COLUMN + 432);
    const widths = new LeftIslandWidth(panel, memoryStore());
    await widths.attach();
    widths.detach();
    panel.show(EXPLORER);
    await settle();
    expect(panel.resizes).toEqual([]);
  });

  it("costs only its memory when storage fails: the policy still sizes the views", async () => {
    const panel = new FakePanel(CLAUDE_TERMINAL_ID, ACTIVITY_COLUMN + 432);
    const warnings: string[] = [];
    const store: LeftWidthStore = { load: () => Promise.reject(new Error("no storage")), save: () => Promise.reject(new Error("no storage")) };
    const widths = new LeftIslandWidth(panel, store, (message) => warnings.push(message));
    await widths.attach();
    panel.show(EXPLORER);
    await settle();
    expect(panel.size).toBe(ACTIVITY_COLUMN + 264);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
