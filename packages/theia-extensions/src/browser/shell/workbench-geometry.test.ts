import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ISLAND_GAP } from "./islands.js";
import {
  ACTIVITY_COLUMN,
  FIRST_LAUNCH_ISLANDS,
  FirstLaunchSizing,
  WORKBENCH,
  areaSize,
  firstLaunchSizes,
  type ShellArea,
  type SizingShell,
} from "./workbench-geometry.js";

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
  it("is on the kit's 4px grid, but for the documented exceptions", () => {
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

// Theia's size for an area is measured from the window's edge to the area's
// split handle; these are the numbers ApplicationShell.resize takes.
describe("an area's size as Theia measures it", () => {
  it("counts the activity column on a side, and the handle on the right and at the bottom", () => {
    expect(ACTIVITY_COLUMN).toBe(52 + ISLAND_GAP);
    expect(areaSize("left", 264)).toBe(52 + 6 + 264);
    expect(areaSize("right", 352)).toBe(6 + 352 + 6 + 52);
    expect(areaSize("bottom", 204)).toBe(6 + 204);
  });

  it("gives the first launch Lumen's islands: Explorer 264, right 352, bottom 204", () => {
    expect(FIRST_LAUNCH_ISLANDS).toEqual({ left: 264, right: 352, bottom: 204 });
    expect(firstLaunchSizes()).toEqual({ left: 322, right: 416, bottom: 210 });
  });

  it("matches how Theia reads each size back, and which left view is in front", () => {
    // left: the handle's offset; right: the parent's width less the handle's offset.
    const getPanelSize = method(theiaSide, "getPanelSize()");
    expect(getPanelSize).toMatch(/return handle\.offsetLeft;/);
    expect(getPanelSize).toMatch(/return parentWidth - handle\.offsetLeft;/);
    expect(method(theiaShell, "getBottomPanelSize()")).toMatch(/return parentHeight - handle\.offsetTop;/);
    // keepAgentFloor reads the left view in front as Theia's current left widget: the side bar's current tab.
    expect(method(theiaShell, "getCurrentWidget(area)")).toMatch(/case 'left':\s*title = this\.leftPanelHandler\.tabBar\.currentTitle;/);
    // And how it writes it: the handle moves to the size, or to the parent's extent less it.
    const startMove = method(theiaSplit, "startMove(move, time)");
    expect(startMove).toMatch(/case 'left':\s*move\.targetPosition = Math\.max\(Math\.min\(move\.targetSize, clientWidth\), 0\);/);
    expect(startMove).toMatch(/case 'right':\s*move\.targetPosition = Math\.max\(Math\.min\(clientWidth - move\.targetSize, clientWidth\), 0\);/);
    expect(startMove).toMatch(/case 'bottom':\s*move\.targetPosition = Math\.max\(Math\.min\(clientHeight - move\.targetSize, clientHeight\), 0\);/);
  });
});

/** A shell that records each resize, and how many pending-update waits came before it. */
function fakeShell(): SizingShell & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    get pendingUpdates() {
      calls.push("settle");
      return Promise.resolve();
    },
    resize: (size: number, area: ShellArea) => calls.push(`${area}:${size}`),
  };
}

describe("first-launch sizing", () => {
  it("does nothing after a restored layout", async () => {
    const shell = fakeShell();
    expect(await new FirstLaunchSizing().apply(shell)).toBe(false);
    expect(shell.calls).toEqual([]);
  });

  it("sizes every area once Theia's pending moves settle, after a default layout", async () => {
    const sizing = new FirstLaunchSizing();
    sizing.markDefaultLayout();
    const shell = fakeShell();
    expect(await sizing.apply(shell)).toBe(true);
    expect(shell.calls).toEqual(["settle", "left:322", "right:416", "bottom:210", "settle"]);
  });

  it("sizes once: a later call leaves the user's layout alone", async () => {
    const sizing = new FirstLaunchSizing();
    sizing.markDefaultLayout();
    await sizing.apply(fakeShell());
    const later = fakeShell();
    expect(await sizing.apply(later)).toBe(false);
    expect(later.calls).toEqual([]);
  });
});

// The flag rides on Theia's own decision: initializeLayout runs only when
// restoreLayout found nothing, and onDidInitializeLayout runs after it, for
// every contribution in binding order, one at a time.
describe("Theia's layout start, which first-launch sizing relies on", () => {
  it("creates the default layout only when nothing was restored", () => {
    expect(method(theiaApp, "async initializeLayout()")).toMatch(/if \(!await this\.restoreLayout\(\)\) \{[\s\S]*?await this\.createDefaultLayout\(\);/);
    expect(method(theiaApp, "async createDefaultLayout()")).toMatch(/contribution\.initializeLayout\(this\)/);
  });

  it("awaits each contribution's onDidInitializeLayout in turn", () => {
    expect(method(theiaApp, "async fireOnDidInitializeLayout()")).toMatch(
      /for \(const contribution of this\.contributions\.getContributions\(\)\) \{[\s\S]*?await this\.measureContribution\(contribution, 'onDidInitializeLayout'/,
    );
  });

  it("is a contribution bound after the bootstrap, whose agent terminal sets its own floor", () => {
    const module = own("../spexr-frontend-module.ts");
    const bootstrap = module.indexOf("bind(FrontendApplicationContribution).to(SpexrBootstrapContribution)");
    const sizing = module.indexOf("bind(FrontendApplicationContribution).to(SpexrFirstLaunchLayoutContribution)");
    expect(bootstrap).toBeGreaterThanOrEqual(0);
    expect(sizing).toBeGreaterThan(bootstrap);
    const contribution = own("./first-launch-layout-contribution.ts");
    expect(contribution).toMatch(/initializeLayout\(\): void \{\s*this\.sizing\.markDefaultLayout\(\);/);
    // The agent terminal keeps its floor when it is the left view in front.
    expect(contribution).toMatch(/if \(await this\.sizing\.apply\(this\.shell\)\) await keepAgentFloor\(this\.shell, CLAUDE_TERMINAL_ID\);/);
  });

  it("awaits the agent terminal's floor, so the first launch's resize lands after it", () => {
    const manager = own("../agent/claude-terminal-manager.ts");
    // side-panel.test.ts drives keepAgentFloor with this id.
    expect(manager).toMatch(/export const CLAUDE_TERMINAL_ID = "spexr-claude";/);
    expect(manager).toMatch(/if \(this\.placement === "left"\) await this\.expandLeftPanel\(\);/);
    expect(manager).toMatch(/private expandLeftPanel\(\): Promise<void> \{\s*return expandLeftPanelWithMinWidth\(this\.shell\);/);
  });

  it("leaves no floor in the layout contribution's every-launch expansion", () => {
    const layout = own("./spexr-shell-layout-contribution.ts");
    expect(layout).not.toMatch(/WithMinWidth/);
    expect(layout).toMatch(/void expandSidePanel\(this\.shell, "left"\);/);
  });
});
