import { describe, expect, it } from "vitest";
import {
  ISLAND_AREA_ATTR,
  ISLAND_CLASS,
  ISLAND_GAP,
  LIT_ATTR,
  PANE_CLASS,
  islandNodes,
  islandSplitOptions,
  litArea,
  markLit,
  tagIslands,
  toIslandArea,
  trackLitIsland,
  type IslandArea,
  type IslandNode,
  type IslandShell,
  type LitShell,
} from "./islands.js";

function fakeNode() {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const node: IslandNode = {
    classList: { add: (...tokens) => tokens.forEach((token) => classes.add(token)) },
    setAttribute: (name, value) => void attrs.set(name, value),
    toggleAttribute: (name, force) => {
      if (force) attrs.set(name, "");
      else attrs.delete(name);
      return force;
    },
  };
  return { node, classes, attrs };
}

function fakeShell(withSides = true) {
  const main = fakeNode();
  const bottom = fakeNode();
  const left = fakeNode();
  const right = fakeNode();
  const shell: IslandShell = {
    mainPanel: { node: main.node },
    bottomPanel: { node: bottom.node },
    leftPanelHandler: { dockPanel: { parent: withSides ? { node: left.node } : null } },
    rightPanelHandler: { dockPanel: { parent: withSides ? { node: right.node } : null } },
  };
  return { shell, main, bottom, left, right };
}

// Theia hard-codes `spacing: 0` on the shell's two splits; the islands need a
// real gap there, which Lumino fills with the split handle (the sash).
describe("islandSplitOptions", () => {
  it("keeps Theia's options and sets the island gap as the spacing", () => {
    expect(islandSplitOptions({ orientation: "vertical", spacing: 0 })).toEqual({ orientation: "vertical", spacing: ISLAND_GAP });
  });

  it("gives a split with no options the gap too", () => {
    expect(islandSplitOptions(undefined)).toEqual({ spacing: ISLAND_GAP });
  });

  it("is the 6px gap Lumen draws between islands", () => {
    expect(ISLAND_GAP).toBe(6);
  });
});

describe("islandNodes", () => {
  it("takes the side content panels, not the side containers", () => {
    const { shell, left, right } = fakeShell();
    const nodes = islandNodes(shell);
    expect(nodes.get("left")).toBe(left.node);
    expect(nodes.get("right")).toBe(right.node);
    expect([...nodes.keys()].sort()).toEqual(["bottom", "left", "main", "right"]);
  });

  it("skips a side whose dock panel is not parented yet", () => {
    const { shell } = fakeShell(false);
    expect([...islandNodes(shell).keys()].sort()).toEqual(["bottom", "main"]);
  });
});

describe("tagIslands", () => {
  it("makes each island the kit's pane and names its area", () => {
    const { shell, main, bottom, left, right } = fakeShell();
    tagIslands(islandNodes(shell));
    for (const island of [main, bottom, left, right]) {
      expect(island.classes).toEqual(new Set([ISLAND_CLASS, PANE_CLASS]));
    }
    expect(PANE_CLASS).toBe("sl-pane");
    expect(main.attrs.get(ISLAND_AREA_ATTR)).toBe("main");
    expect(bottom.attrs.get(ISLAND_AREA_ATTR)).toBe("bottom");
    expect(left.attrs.get(ISLAND_AREA_ATTR)).toBe("left");
    expect(right.attrs.get(ISLAND_AREA_ATTR)).toBe("right");
  });
});

describe("toIslandArea", () => {
  it.each<[string | undefined, IslandArea | undefined]>([
    ["left", "left"],
    ["main", "main"],
    ["bottom", "bottom"],
    ["right", "right"],
    ["top", undefined],
    ["secondaryWindow", undefined],
    [undefined, undefined],
  ])("maps %s to %s", (area, expected) => {
    expect(toIslandArea(area)).toBe(expected);
  });
});

describe("markLit", () => {
  it("lights exactly one island and moves the light", () => {
    const { shell, main, bottom, left, right } = fakeShell();
    const nodes = islandNodes(shell);
    markLit(nodes, "main");
    expect([main, bottom, left, right].map((island) => island.attrs.has(LIT_ATTR))).toEqual([true, false, false, false]);
    markLit(nodes, "bottom");
    expect([main, bottom, left, right].map((island) => island.attrs.has(LIT_ATTR))).toEqual([false, true, false, false]);
  });

  it("writes the kit's lit attribute", () => {
    expect(LIT_ATTR).toBe("data-lit");
  });

  it("unlights every island when no area is given", () => {
    const { shell, main, bottom, left, right } = fakeShell();
    const nodes = islandNodes(shell);
    markLit(nodes, "left");
    markLit(nodes, undefined);
    for (const island of [main, bottom, left, right]) {
      expect(island.attrs.has(LIT_ATTR)).toBe(false);
    }
  });
});

/** A shell whose widgets are names, each in the area `areas` gives it, with the two focus events. */
function fakeLitShell(areas: Record<string, string>) {
  const listeners: Array<() => void> = [];
  const shell: LitShell<string> & { activeWidget: string | undefined; currentWidget: string | undefined } = {
    activeWidget: undefined,
    currentWidget: undefined,
    getAreaFor: (widget) => areas[widget],
    onDidChangeActiveWidget: (listener) => listeners.push(listener),
    onDidChangeCurrentWidget: (listener) => listeners.push(listener),
  };
  const focus = (active: string | undefined, current = active): void => {
    shell.activeWidget = active;
    shell.currentWidget = current;
    for (const listener of listeners) listener();
  };
  return { shell, focus, listeners };
}

const AREAS = { editor: "main", explorer: "left", terminal: "bottom", memory: "right", menu: "top", popout: "secondaryWindow" };

/** Which islands carry the lit mark, by area. */
const litOf = (islands: ReturnType<typeof fakeShell>): IslandArea[] =>
  (["main", "bottom", "left", "right"] as const).filter((area) => islands[area].attrs.has(LIT_ATTR));

// The lit pane follows the shell's own focus tracking: the active widget, or
// the current one while a menu, a dialog or the palette has the focus.
describe("litArea", () => {
  it("is the active widget's island", () => {
    const { shell } = fakeLitShell(AREAS);
    shell.activeWidget = "explorer";
    shell.currentWidget = "editor";
    expect(litArea(shell)).toBe("left");
  });

  it("falls back to the current widget when no widget is active", () => {
    const { shell } = fakeLitShell(AREAS);
    shell.currentWidget = "terminal";
    expect(litArea(shell)).toBe("bottom");
  });

  it.each(["menu", "popout"])("lights nothing for a widget outside the islands (%s)", (widget) => {
    const { shell } = fakeLitShell(AREAS);
    shell.activeWidget = widget;
    shell.currentWidget = "editor";
    expect(litArea(shell)).toBeUndefined();
  });

  it("lights nothing before any widget has had the focus", () => {
    expect(litArea(fakeLitShell(AREAS).shell)).toBeUndefined();
  });
});

describe("trackLitIsland", () => {
  it("lights the focused island at once, before any event", () => {
    const islands = fakeShell();
    const { shell } = fakeLitShell(AREAS);
    shell.activeWidget = "editor";
    trackLitIsland(shell, islandNodes(islands.shell));
    expect(litOf(islands)).toEqual(["main"]);
  });

  it("listens to both of the shell's focus events", () => {
    const { shell, listeners } = fakeLitShell(AREAS);
    trackLitIsland(shell, islandNodes(fakeShell().shell));
    expect(listeners).toHaveLength(2);
  });

  it("moves the one light with the focus, and keeps it while a menu holds the focus", () => {
    const islands = fakeShell();
    const { shell, focus } = fakeLitShell(AREAS);
    trackLitIsland(shell, islandNodes(islands.shell));
    expect(litOf(islands)).toEqual([]);
    focus("editor");
    expect(litOf(islands)).toEqual(["main"]);
    focus("explorer");
    expect(litOf(islands)).toEqual(["left"]);
    focus(undefined, "explorer");
    expect(litOf(islands)).toEqual(["left"]);
    focus("terminal");
    expect(litOf(islands)).toEqual(["bottom"]);
    focus("popout", "terminal");
    expect(litOf(islands)).toEqual([]);
  });
});
