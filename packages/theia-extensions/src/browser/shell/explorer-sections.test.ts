import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HIDDEN_BY_DEFAULT_SECTIONS,
  OPEN_EDITORS_WIDGET_ID,
  SMART_SEARCH_EVICTION_ID,
  clearMigrations,
  hideSectionsOnce,
  runMigrationOnce,
  parseMigrated,
  type ExplorerSections,
  type MigrationStore,
} from "./explorer-sections.js";

const resolve = createRequire(import.meta.url).resolve;

/** An Explorer with these sections, showing all of them; hiding is recorded. */
function explorer(present: string[]): ExplorerSections & { hidden: string[]; present: string[] } {
  const hidden: string[] = [];
  return {
    hidden,
    present,
    has: (id) => present.includes(id),
    hide: (id) => {
      hidden.push(id);
    },
  };
}

function memoryStore(initial: unknown = undefined): MigrationStore & { value: unknown } {
  const store = {
    value: initial,
    load: () => Promise.resolve(store.value),
    save: (ids: readonly string[]) => {
      store.value = [...ids];
      return Promise.resolve();
    },
  };
  return store;
}

describe("the Explorer's default-hidden sections", () => {
  it("are Open Editors, by the widget id Theia gives it", () => {
    expect(OPEN_EDITORS_WIDGET_ID).toBe("theia-open-editors-widget");
    expect(HIDDEN_BY_DEFAULT_SECTIONS).toEqual([OPEN_EDITORS_WIDGET_ID]);
  });

  it("are named as the installed Theia names them: Open Editors' widget id", () => {
    const openEditors = readFileSync(resolve("@theia/navigator/lib/browser/open-editors-widget/navigator-open-editors-widget.js"), "utf8");
    expect(openEditors).toContain("this.ID = 'theia-open-editors-widget'");
  });

  it("hides each present section once and records it", async () => {
    const store = memoryStore();
    const sections = explorer([OPEN_EDITORS_WIDGET_ID, "files"]);
    expect(await hideSectionsOnce(store, sections)).toEqual([OPEN_EDITORS_WIDGET_ID]);
    expect(sections.hidden).toEqual([OPEN_EDITORS_WIDGET_ID]);
    expect(store.value).toEqual([OPEN_EDITORS_WIDGET_ID]);
  });

  it("is idempotent: a second run, and a later launch, hide nothing, so a section the user showed stays shown", async () => {
    const store = memoryStore();
    const sections = explorer([OPEN_EDITORS_WIDGET_ID]);
    await hideSectionsOnce(store, sections);
    expect(await hideSectionsOnce(store, sections)).toEqual([]);
    expect(await hideSectionsOnce(store, explorer([OPEN_EDITORS_WIDGET_ID]))).toEqual([]);
    expect(sections.hidden).toEqual([OPEN_EDITORS_WIDGET_ID]);
  });

  it("writes nothing when there is nothing to hide", async () => {
    const store = memoryStore();
    store.save = () => Promise.reject(new Error("must not save"));
    expect(await hideSectionsOnce(store, explorer(["files"]))).toEqual([]);
  });

  it("reads what storage holds defensively", () => {
    expect(parseMigrated(undefined)).toEqual([]);
    expect(parseMigrated("theia-open-editors-widget")).toEqual([]);
    expect(parseMigrated({ a: 1 })).toEqual([]);
    expect(parseMigrated([OPEN_EDITORS_WIDGET_ID, 3, null])).toEqual([OPEN_EDITORS_WIDGET_ID]);
  });
});

describe("the layout migrations' one done-list", () => {
  it("runs the Smart Search move once, and records it beside the sections", async () => {
    const store = memoryStore();
    let ran = 0;
    expect(await runMigrationOnce(store, SMART_SEARCH_EVICTION_ID, () => void ran++)).toBe(true);
    expect(await runMigrationOnce(store, SMART_SEARCH_EVICTION_ID, () => void ran++)).toBe(false);
    expect(ran).toBe(1);
    await hideSectionsOnce(store, explorer([OPEN_EDITORS_WIDGET_ID]));
    expect(store.value).toEqual([SMART_SEARCH_EVICTION_ID, OPEN_EDITORS_WIDGET_ID]);
  });

  it("does not record a move that threw, so the next launch tries again", async () => {
    const store = memoryStore();
    await runMigrationOnce(store, SMART_SEARCH_EVICTION_ID, () => {
      throw new Error("no");
    }).catch(() => undefined);
    expect(store.value).toBeUndefined();
  });

  it("is emptied by Reset Layout: the Explorer the reset builds has its sections hidden again, and Smart Search is decided again", async () => {
    const store = memoryStore();
    await hideSectionsOnce(store, explorer([OPEN_EDITORS_WIDGET_ID]));
    await runMigrationOnce(store, SMART_SEARCH_EVICTION_ID, () => undefined);
    await clearMigrations(store);
    expect(store.value).toEqual([]);
    const rebuilt = explorer([OPEN_EDITORS_WIDGET_ID]);
    expect(await hideSectionsOnce(store, rebuilt)).toEqual([OPEN_EDITORS_WIDGET_ID]);
    expect(await runMigrationOnce(store, SMART_SEARCH_EVICTION_ID, () => undefined)).toBe(true);
  });

  it("never lets two migrations read and write the list at once: both ids survive", async () => {
    const store = memoryStore();
    await Promise.all([runMigrationOnce(store, SMART_SEARCH_EVICTION_ID, () => undefined), hideSectionsOnce(store, explorer([OPEN_EDITORS_WIDGET_ID]))]);
    expect((store.value as string[]).sort()).toEqual([OPEN_EDITORS_WIDGET_ID, SMART_SEARCH_EVICTION_ID].sort());
  });

  it("is cleared by Reset Layout before the default layout is rebuilt, and the Explorer's hooks follow each container Theia creates", () => {
    const own = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
    const layout = own("./spexr-shell-layout-contribution.ts");
    expect(layout.indexOf("await clearMigrations(")).toBeGreaterThan(layout.indexOf("await this.detachManagedViews();"));
    expect(layout.indexOf("await clearMigrations(")).toBeLessThan(layout.indexOf("await this.applyDefaultLayout();\n    await this.removeActivityViews();\n    await this.attachOutput();\n    await this.defaultLayout.resetSizes();"));
    const chrome = own("./explorer-chrome-contribution.ts");
    expect(chrome).toMatch(/onDidCreateWidget\(\(\{ factoryId, widget \}\) => \{\s*if \(factoryId === EXPLORER_VIEW_CONTAINER_ID\) this\.attach\(widget as ViewContainer\);/);
  });
});
