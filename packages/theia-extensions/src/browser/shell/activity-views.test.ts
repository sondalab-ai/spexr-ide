import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ACTIVITY_VIEWS_MIGRATION_ID,
  AGENT_LEFT_RANK,
  DEBUG_VIEW_ID,
  EXTENSIONS_VIEW_ID,
  removeActivityViewsOnce,
  type ActivityViews,
} from "./activity-views.js";
import type { MigrationStore } from "./explorer-sections.js";

const resolve = createRequire(import.meta.url).resolve;
const theia = (file: string): string => readFileSync(resolve(file), "utf8");
const own = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

/** The `rank: N` of a Theia view contribution's default widget options. */
function rankOf(source: string, widgetId: string): number {
  const at = source.indexOf(widgetId);
  expect(at, widgetId).toBeGreaterThanOrEqual(0);
  const m = /rank:\s*(\d+)/.exec(source.slice(at));
  expect(m, `rank after ${widgetId}`).not.toBeNull();
  return Number(m![1]);
}

describe("the left activity bar's order (S6d, A1)", () => {
  it("is Explorer, Search, Source Control, Agent, Testing", () => {
    const explorer = rankOf(theia("@theia/navigator/src/browser/navigator-contribution.ts"), "widgetId: FILE_NAVIGATOR_ID");
    const search = rankOf(theia("@theia/search-in-workspace/src/browser/search-in-workspace-frontend-contribution.ts"), "widgetId: SearchInWorkspaceWidget.ID");
    const scm = rankOf(theia("@theia/scm/src/browser/scm-contribution.ts"), "widgetId: SCM_WIDGET_FACTORY_ID");
    const testing = rankOf(theia("@theia/test/src/browser/view/test-view-contribution.ts"), "widgetId: TestTreeWidget.ID");
    expect([explorer, search, scm, AGENT_LEFT_RANK, testing]).toEqual([...[explorer, search, scm, AGENT_LEFT_RANK, testing]].sort((a, b) => a - b));
    expect(new Set([explorer, search, scm, AGENT_LEFT_RANK, testing]).size).toBe(5);
  });

  it("puts the agent terminal there wherever it docks left", () => {
    const manager = own("../agent/claude-terminal-manager.ts");
    expect((manager.match(/area: "left", rank: AGENT_LEFT_RANK/g) ?? []).length).toBe(2);
    expect(manager).not.toMatch(/area: "left", rank: 1\b/);
  });

  it("leaves Debug and Extensions in Theia's order behind the agent, for a user who shows them", () => {
    expect(rankOf(theia("@theia/debug/src/browser/debug-frontend-application-contribution.ts"), "widgetId: DebugWidget.ID")).toBeGreaterThan(AGENT_LEFT_RANK);
    expect(rankOf(theia("@theia/vsx-registry/src/browser/vsx-extensions-contribution.ts"), "widgetId: VSXExtensionsViewContainer.ID")).toBeGreaterThan(AGENT_LEFT_RANK);
  });
});

describe("Debug and Extensions leaving the default layout (A2)", () => {
  it("names the ids Theia gives the two views", () => {
    expect(theia("@theia/debug/src/browser/view/debug-widget.ts")).toContain(`static ID = '${DEBUG_VIEW_ID}'`);
    expect(theia("@theia/vsx-registry/src/browser/vsx-extensions-view-container.ts")).toContain(`static ID = '${EXTENSIONS_VIEW_ID}'`);
  });

  it("is an override of the two contributions' initializeLayout, which is where Theia opens them", () => {
    expect(theia("@theia/debug/src/browser/debug-frontend-application-contribution.ts")).toMatch(/async initializeLayout\(\): Promise<void> \{\s*await this\.openView\(\);/);
    expect(theia("@theia/vsx-registry/src/browser/vsx-extensions-contribution.ts")).toMatch(/async initializeLayout\(app: FrontendApplication\): Promise<void> \{\s*await this\.openView\(/);
    const ours = own("./activity-view-contributions.ts");
    expect(ours).toContain("class SpexrDebugContribution extends DebugFrontendApplicationContribution");
    expect(ours).toContain("class SpexrExtensionsContribution extends VSXExtensionsContribution");
    expect((ours.match(/override async initializeLayout\(\): Promise<void> \{\}/g) ?? []).length).toBe(2);
    const module = own("../spexr-frontend-module.ts");
    expect(module).toContain("rebind(DebugFrontendApplicationContribution).to(SpexrDebugContribution)");
    expect(module).toContain("rebind(VSXExtensionsContribution).to(SpexrExtensionsContribution)");
  });
});

/** An in-memory migration list and left widgets, to run the removal against. */
function fixture(present: string[]): { store: MigrationStore; views: ActivityViews; saved: () => string[]; closed: string[] } {
  let saved: string[] = [];
  const closed: string[] = [];
  return {
    store: { load: async () => saved, save: async (ids) => { saved = [...ids]; } },
    views: {
      has: (id) => present.includes(id),
      close: (id) => {
        closed.push(id);
        present.splice(present.indexOf(id), 1);
      },
    },
    saved: () => saved,
    closed,
  };
}

describe("the one-time removal", () => {
  it("closes the two views where a layout has them, and records itself", async () => {
    const f = fixture([DEBUG_VIEW_ID, EXTENSIONS_VIEW_ID, "explorer-view-container"]);
    expect(await removeActivityViewsOnce(f.store, f.views)).toBe(true);
    expect(f.closed).toEqual([DEBUG_VIEW_ID, EXTENSIONS_VIEW_ID]);
    expect(f.saved()).toEqual([ACTIVITY_VIEWS_MIGRATION_ID]);
  });

  it("is idempotent: a view the user shows afterwards stays", async () => {
    const present = [DEBUG_VIEW_ID];
    const f = fixture(present);
    await removeActivityViewsOnce(f.store, f.views);
    present.push(DEBUG_VIEW_ID);
    expect(await removeActivityViewsOnce(f.store, f.views)).toBe(false);
    expect(f.closed).toEqual([DEBUG_VIEW_ID]);
    expect(present).toEqual([DEBUG_VIEW_ID]);
  });

  it("records itself on a layout that has neither view, and keeps the other migrations' ids", async () => {
    let list: string[] = ["smart-search-eviction"];
    const store: MigrationStore = { load: async () => list, save: async (ids) => { list = [...ids]; } };
    expect(await removeActivityViewsOnce(store, { has: () => false, close: () => undefined })).toBe(true);
    expect(list).toEqual(["smart-search-eviction", ACTIVITY_VIEWS_MIGRATION_ID]);
  });

  it("is not recorded when a close throws, so the next launch tries again", async () => {
    const f = fixture([DEBUG_VIEW_ID]);
    await expect(removeActivityViewsOnce(f.store, { has: () => true, close: () => { throw new Error("boom"); } })).rejects.toThrow("boom");
    expect(f.saved()).toEqual([]);
  });

  it("runs again after Reset Layout clears the list", async () => {
    const present = [DEBUG_VIEW_ID];
    const f = fixture(present);
    await removeActivityViewsOnce(f.store, f.views);
    await f.store.save([]);
    present.push(DEBUG_VIEW_ID);
    expect(await removeActivityViewsOnce(f.store, f.views)).toBe(true);
    expect(f.closed).toEqual([DEBUG_VIEW_ID, DEBUG_VIEW_ID]);
  });

  it("is wired after the side views open, and again after a reset's default layout", () => {
    const layout = own("./spexr-shell-layout-contribution.ts");
    expect(layout).toMatch(/await this\.openSideViews\(\);\s*await this\.removeActivityViews\(\);/);
    expect(layout).toMatch(/await this\.applyDefaultLayout\(\);\s*await this\.removeActivityViews\(\);/);
  });
});
