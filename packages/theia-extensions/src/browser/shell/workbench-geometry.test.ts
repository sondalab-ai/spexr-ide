import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ISLAND_GAP } from "./islands.js";
import {
  ACTIVITY_COLUMN,
  AGENT_ISLAND,
  BOTTOM_ISLAND,
  DefaultLayout,
  EXPLORER_ISLAND,
  PALETTE,
  RIGHT_ISLAND,
  TOAST,
  WORKBENCH,
  areaSize,
  defaultIslands,
  defaultSizes,
  type LayoutReporter,
  type ShellArea,
  type SizingShell,
} from "./workbench-geometry.js";
import { MIN_LEFT_ISLAND_WIDTH, MIN_RIGHT_ISLAND_WIDTH } from "./side-panel.js";

const resolve = createRequire(import.meta.url).resolve;
const theiaApp = readFileSync(resolve("@theia/core/lib/browser/frontend-application.js"), "utf8");
const theiaShell = readFileSync(resolve("@theia/core/lib/browser/shell/application-shell.js"), "utf8");
const theiaSide = readFileSync(resolve("@theia/core/lib/browser/shell/side-panel-handler.js"), "utf8");
const theiaSplit = readFileSync(resolve("@theia/core/lib/browser/shell/split-panels.js"), "utf8");
const own = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

/** A method's body from a compiled Theia class: from its signature to the next method at the same indent. */
function method(source: string, signature: string): string {
  const start = source.indexOf(`\n    ${signature} {`);
  expect(start, signature).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("\n    }\n", start));
}

describe("the geometry table", () => {
  it("is on the kit's 4px grid, every value", () => {
    // Lumen's own numbers where they are on the grid; the kit's where Lumen is between two steps.
    const offGrid = Object.entries(WORKBENCH).filter(([, v]) => v % 4 !== 0);
    expect(offGrid).toEqual([]);
  });

  it("keeps Lumen's 44px activity pitch and the code's top edge", () => {
    expect(WORKBENCH.activityItem + WORKBENCH.activityGap).toBe(44);
    // The demo's code starts 38 + 30 below the island's top edge.
    expect(WORKBENCH.tabStrip + WORKBENCH.breadcrumbs).toBe(38 + 30);
  });

  it("centres a tab and a status item on the grid", () => {
    expect((WORKBENCH.tabStrip - WORKBENCH.tab) / 2).toBe(4);
    expect((WORKBENCH.statusBar - WORKBENCH.statusItem) / 2).toBe(4);
  });
});

describe("the palette's and the toast's tables", () => {
  it("anchors the palette at the demo's y 118, from the frame it floats in", () => {
    expect(PALETTE.top).toBe(118);
    expect(PALETTE.top).toBe(44 + 36 + 32 + ISLAND_GAP);
    expect(PALETTE.width).toBe(580);
  });

  // The top is the frame's 6px island gap (44 + 36 + 32 + 6); the radius is shape, as the table's own note says.
  it("keeps every palette length on the grid except its 118px top and its 14px radius", () => {
    const offGrid = Object.entries(PALETTE).filter(([, v]) => v % 4 !== 0).map(([k]) => k);
    expect(offGrid).toEqual(["top", "radius"]);
    expect(PALETTE.row).toBe(36);
    expect(PALETTE.detailRow).toBeGreaterThan(PALETTE.row);
  });

  it("sizes the toast as the demo's 360px card, the dismiss and the mark on the grid", () => {
    expect(TOAST.width).toBe(360);
    expect(Object.entries(TOAST).filter(([, v]) => v % 4 !== 0)).toEqual([]);
    expect(WORKBENCH.toastOffset).toBe(48);
  });
});

// Theia's size for an area is measured from the window's edge to the area's
// split handle; these are the numbers ApplicationShell.resize takes.
describe("an area's size as Theia measures it", () => {
  it("counts the activity column on a side, and the handle on the right and at the bottom", () => {
    expect(ACTIVITY_COLUMN).toBe(52 + ISLAND_GAP);
    expect(areaSize("left", 264)).toBe(52 + 6 + 264);
    expect(areaSize("right", 352)).toBe(6 + 352 + 6 + 52);
    expect(areaSize("bottom", 204)).toBe(6 + 204);
  });

  it("gives a default layout Lumen's islands, the left one the agent terminal's when it is in front", () => {
    expect(defaultIslands(false)).toEqual({ left: 264, right: 352, bottom: 204 });
    expect(defaultIslands(true)).toEqual({ left: 432, right: 352, bottom: 204 });
    expect(defaultSizes(false)).toEqual({ left: 322, right: 416, bottom: 210 });
    expect(defaultSizes(true)).toEqual({ left: 490, right: 416, bottom: 210 });
    expect([EXPLORER_ISLAND, AGENT_ISLAND, RIGHT_ISLAND, BOTTOM_ISLAND].every((v) => v % 4 === 0)).toBe(true);
  });

  it("defines each island once: the floors are the same numbers", () => {
    expect(MIN_LEFT_ISLAND_WIDTH).toBe(AGENT_ISLAND);
    expect(MIN_RIGHT_ISLAND_WIDTH).toBe(RIGHT_ISLAND);
  });

  it("matches how Theia reads each size back and writes it, and which left view is in front", () => {
    // left: the handle's offset; right: the parent's width less the handle's offset.
    const getPanelSize = method(theiaSide, "getPanelSize()");
    expect(getPanelSize).toMatch(/return handle\.offsetLeft;/);
    expect(getPanelSize).toMatch(/return parentWidth - handle\.offsetLeft;/);
    expect(method(theiaShell, "getBottomPanelSize()")).toMatch(/return parentHeight - handle\.offsetTop;/);
    // Reset Layout reads the left view in front as Theia's current left widget: the side bar's current tab.
    expect(method(theiaShell, "getCurrentWidget(area)")).toMatch(/case 'left':\s*title = this\.leftPanelHandler\.tabBar\.currentTitle;/);
    // And how it writes it: the handle moves to the size, or to the parent's extent less it.
    const startMove = method(theiaSplit, "startMove(move, time)");
    expect(startMove).toMatch(/case 'left':\s*move\.targetPosition = Math\.max\(Math\.min\(move\.targetSize, clientWidth\), 0\);/);
    expect(startMove).toMatch(/case 'right':\s*move\.targetPosition = Math\.max\(Math\.min\(clientWidth - move\.targetSize, clientWidth\), 0\);/);
    expect(startMove).toMatch(/case 'bottom':\s*move\.targetPosition = Math\.max\(Math\.min\(clientHeight - move\.targetSize, clientHeight\), 0\);/);
  });
});

/**
 * A shell that records each resize and each wait for Theia's pending moves,
 * and reads back the sizes it was given, or `readBack`'s where set.
 */
function fakeShell(readBack: Partial<Record<ShellArea, number>> = {}, throwOnResize = false, stalled = false): SizingShell & { calls: string[] } {
  const calls: string[] = [];
  const sizes: Partial<Record<ShellArea, number>> = {};
  return {
    calls,
    get pendingUpdates() {
      calls.push("settle");
      // A stalled shell: a panel move that never ends.
      return stalled ? new Promise<void>(() => undefined) : Promise.resolve();
    },
    resize: (size: number, area: ShellArea) => {
      if (throwOnResize) throw new Error("no shell");
      calls.push(`${area}:${size}`);
      sizes[area] = size;
    },
    getLayoutData: () => ({
      leftPanel: { size: readBack.left ?? sizes.left },
      rightPanel: { size: readBack.right ?? sizes.right },
      bottomPanel: { size: readBack.bottom ?? sizes.bottom },
    }),
  };
}

/** A reporter that records its warnings and when the layout was marked settled. */
function reporter(): LayoutReporter & { log: string[] } {
  const log: string[] = [];
  return { log, warn: (message: string) => log.push(`warn: ${message}`), markSettled: () => log.push("settled") };
}

describe("the default layout", () => {
  it("is sized before the shell is ready, once, the left island the agent terminal's when it will be in front", () => {
    const shell = fakeShell();
    new DefaultLayout(reporter()).seed(shell, true);
    // No wait: Theia keeps a hidden or collapsed area's size for when it opens.
    expect(shell.calls).toEqual(["left:490", "right:416", "bottom:210"]);
    const explorer = fakeShell();
    new DefaultLayout(reporter()).seed(explorer, false);
    expect(explorer.calls).toEqual(["left:322", "right:416", "bottom:210"]);
  });

  it("marks the layout settled after reading the sizes back, and is quiet when they landed", async () => {
    const log = reporter();
    const layout = new DefaultLayout(log);
    const shell = fakeShell();
    layout.seed(shell, true);
    await layout.settle(shell);
    expect(shell.calls).toEqual(["left:490", "right:416", "bottom:210", "settle"]);
    expect(log.log).toEqual(["settled"]);
  });

  it("warns about a size that did not land, and still marks the layout settled", async () => {
    const log = reporter();
    const layout = new DefaultLayout(log);
    const shell = fakeShell({ left: 400 });
    layout.seed(shell, true);
    await layout.settle(shell);
    expect(log.log).toEqual(["warn: [spexr] the default layout's sizes did not land", "settled"]);
  });

  it("swallows a shell that throws: a warning, and the mark all the same", async () => {
    const log = reporter();
    const layout = new DefaultLayout(log);
    const shell = fakeShell({}, true);
    layout.seed(shell, true); // a throw here fails the test
    await layout.settle(shell);
    expect(log.log).toEqual(["warn: [spexr] the default layout's sizes could not be set", "settled"]);
  });

  it("marks the layout settled anyway when Theia's panel moves never end, after its wait, with a warning", async () => {
    const log = reporter();
    const layout = new DefaultLayout(log, 20);
    const shell = fakeShell({}, false, true);
    layout.seed(shell, true);
    await layout.settle(shell);
    expect(log.log).toEqual(["warn: [spexr] Theia's panel moves did not end within 20ms; the sizes are not checked", "settled"]);
  });

  it("gives up on a stalled Reset Layout after its waits, with warnings, and never hangs", async () => {
    const log = reporter();
    const shell = fakeShell({}, false, true);
    await new DefaultLayout(log, 20).reset(shell, false);
    // It still asks for the sizes: a stalled earlier move does not cancel them.
    expect(shell.calls).toEqual(["settle", "left:322", "right:416", "bottom:210", "settle"]);
    expect(log.log).toEqual([
      "warn: [spexr] Theia's panel moves did not end within 20ms; the sizes are not checked",
      "warn: [spexr] Theia's panel moves did not end within 20ms; the sizes are not checked",
    ]);
  });

  it("waits five seconds by default", () => {
    expect(own("./workbench-geometry.ts")).toMatch(/private readonly waitMs = 5_000,/);
  });

  it("only marks the layout settled after a restored layout: no sizes, no reads", async () => {
    const log = reporter();
    const shell = fakeShell();
    await new DefaultLayout(log).settle(shell);
    expect(shell.calls).toEqual([]);
    expect(log.log).toEqual(["settled"]);
  });

  it("checks a seeded layout once: a later settle leaves the user's sizes alone", async () => {
    const log = reporter();
    const layout = new DefaultLayout(log);
    const shell = fakeShell();
    layout.seed(shell, false);
    await layout.settle(shell);
    const later = fakeShell({ left: 600 });
    await layout.settle(later);
    expect(later.calls).toEqual([]);
    expect(log.log).toEqual(["settled", "settled"]);
  });

  it("reapplies the default sizes on Reset Layout, after Theia's pending moves, the left by the view in front", async () => {
    const log = reporter();
    const shell = fakeShell();
    await new DefaultLayout(log).reset(shell, false);
    expect(shell.calls).toEqual(["settle", "left:322", "right:416", "bottom:210", "settle"]);
    const agent = fakeShell();
    await new DefaultLayout(log).reset(agent, true);
    expect(agent.calls).toEqual(["settle", "left:490", "right:416", "bottom:210", "settle"]);
    expect(log.log).toEqual([]);
  });
});

// The decisions ride on Theia's own start: initializeLayout runs only when
// restoreLayout found nothing, before onDidInitializeLayout, which runs for
// every contribution in binding order, one at a time; and Theia keeps a size
// given to a hidden or collapsed area for when it opens.
describe("Theia's layout start, which the default layout relies on", () => {
  it("creates the default layout only when nothing was restored", () => {
    expect(method(theiaApp, "async initializeLayout()")).toMatch(/if \(!await this\.restoreLayout\(\)\) \{[\s\S]*?await this\.createDefaultLayout\(\);/);
    expect(method(theiaApp, "async createDefaultLayout()")).toMatch(/contribution\.initializeLayout\(this\)/);
  });

  it("awaits each contribution's onDidInitializeLayout in turn, and reveals the shell after them", () => {
    expect(method(theiaApp, "async fireOnDidInitializeLayout()")).toMatch(
      /for \(const contribution of this\.contributions\.getContributions\(\)\) \{[\s\S]*?await this\.measureContribution\(contribution, 'onDidInitializeLayout'/,
    );
    expect(method(theiaApp, "async start()")).toMatch(/initializeLayout\(\)[\s\S]*fireOnDidInitializeLayout\(\)[\s\S]*revealShell/);
  });

  it("keeps a hidden or collapsed area's size for when it opens", () => {
    expect(method(theiaShell, "resize(size, area)")).toMatch(/case 'bottom':\s*if \(this\.bottomPanel\.isHidden\) \{\s*this\.bottomPanelState\.lastPanelSize = size;/);
    expect(method(theiaSide, "resize(size)")).toMatch(/if \(this\.dockPanel\.isHidden\) \{\s*this\.state\.lastPanelSize = size;/);
    expect(method(theiaSide, "refresh()")).toMatch(/if \(this\.state\.lastPanelSize\) \{\s*size = this\.state\.lastPanelSize;/);
  });

  it("is the last contribution spexr binds, so its mark comes after every layout change, and it marks the layout settled", () => {
    const module = own("../spexr-frontend-module.ts");
    const sizes = module.indexOf("bind(FrontendApplicationContribution).toService(SpexrDefaultLayoutContribution)");
    expect(sizes).toBeGreaterThanOrEqual(0);
    // Every other FrontendApplicationContribution binding comes before it: the
    // shell layout, the bootstrap, the Explorer's Search section and the rest.
    const contributions = [...module.matchAll(/bind\(FrontendApplicationContribution\)\.(?:to|toService)\((\w+)\)/g)];
    expect(contributions.length).toBeGreaterThan(20);
    expect(contributions.at(-1)![1]).toBe("SpexrDefaultLayoutContribution");
    for (const name of ["SpexrShellLayoutContribution", "SpexrBootstrapContribution", "SpexrSmartSearchContribution", "SpexrDarkfactorySidebarVisibilityContribution"]) {
      const at = module.indexOf(`bind(FrontendApplicationContribution).toService(${name})`) >= 0
        ? module.indexOf(`bind(FrontendApplicationContribution).toService(${name})`)
        : module.indexOf(`bind(FrontendApplicationContribution).to(${name})`);
      expect(at, name).toBeGreaterThanOrEqual(0);
      expect(at, name).toBeLessThan(sizes);
    }
    const contribution = own("./default-layout-contribution.ts");
    // The adapter only delegates: the logic is DefaultLayout's, tested above.
    expect(contribution).toMatch(/async initializeLayout\(\): Promise<void> \{\s*await this\.workspace\.ready;\s*this\.layout\.seed\(this\.shell, this\.workspace\.opened\);/);
    expect(contribution).toMatch(/onDidInitializeLayout\(\): Promise<void> \{\s*return this\.layout\.settle\(this\.shell\);/);
    expect(contribution).toMatch(/return this\.layout\.reset\(this\.shell, this\.shell\.getCurrentWidget\("left"\)\?\.id === CLAUDE_TERMINAL_ID\);/);
    expect(contribution).toMatch(/markSettled: \(\) => document\.body\.setAttribute\(LAYOUT_READY_ATTRIBUTE, "1"\)/);
    expect(contribution).toContain('export const LAYOUT_READY_ATTRIBUTE = "data-spexr-layout-ready";');
  });

  it("seeds the agent terminal's island exactly when the bootstrap will put it in front: a workspace is open", () => {
    const bootstrap = own("../bootstrap/spexr-bootstrap-contribution.ts");
    expect(bootstrap).toMatch(/if \(!this\.workspace\.opened\) return;[\s\S]*?await this\.terminalManager\.ensureStarted\(\);/);
    const manager = own("../agent/claude-terminal-manager.ts");
    // The id lives in a light module of its own, which the adapter imports; the manager re-exports it.
    expect(own("../agent/claude-terminal-id.ts")).toMatch(/export const CLAUDE_TERMINAL_ID = "spexr-claude";/);
    expect(own("./default-layout-contribution.ts")).toContain('import { CLAUDE_TERMINAL_ID } from "../agent/claude-terminal-id.js";');
    expect(manager).toMatch(/export \{ CLAUDE_TERMINAL_ID \};/);
    expect(manager).toMatch(/if \(this\.placement === "left"\) await this\.expandLeftPanel\(\);/);
  });

  it("leaves the settled mark to the default layout, and reapplies the sizes on Reset Layout", () => {
    const layout = own("./spexr-shell-layout-contribution.ts");
    expect(layout).not.toMatch(/spexrLayoutReady|data-spexr-layout-ready/);
    expect(layout).toMatch(/await this\.applyDefaultLayout\(\);\s*await this\.defaultLayout\.resetSizes\(\);/);
    // The every-launch expansion keeps a restored width: no floor of its own.
    expect(layout).toMatch(/void expandSidePanel\(this\.shell, "left"\);/);
    // The e2e suite waits on the same mark.
    expect(own("../../../../../tests/e2e/fixtures/app.ts")).toContain('page.waitForSelector("body[data-spexr-layout-ready]"');
  });
});
