import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  HIDDEN_BY_DEFAULT_SECTIONS,
  NPM_SCRIPTS_WIDGET_ID,
  OPEN_EDITORS_WIDGET_ID,
  hideSectionsOnce,
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
  it("are Open Editors and NPM Scripts, by the widget ids Theia gives them", () => {
    expect(OPEN_EDITORS_WIDGET_ID).toBe("theia-open-editors-widget");
    expect(NPM_SCRIPTS_WIDGET_ID).toBe("plugin-view:npm");
    expect(HIDDEN_BY_DEFAULT_SECTIONS).toEqual([OPEN_EDITORS_WIDGET_ID, NPM_SCRIPTS_WIDGET_ID]);
  });

  it("are named as the installed Theia names them: Open Editors' widget id, and a plugin view's `plugin-view:<view id>`", () => {
    const openEditors = readFileSync(resolve("@theia/navigator/lib/browser/open-editors-widget/navigator-open-editors-widget.js"), "utf8");
    expect(openEditors).toContain("this.ID = 'theia-open-editors-widget'");
    const registry = readFileSync(resolve("@theia/plugin-ext/lib/main/browser/view/plugin-view-registry.js"), "utf8");
    expect(registry).toContain("exports.PLUGIN_VIEW_FACTORY_ID = 'plugin-view';");
    expect(registry).toContain("return { id: exports.PLUGIN_VIEW_FACTORY_ID + ':' + viewId, viewId };");
  });

  it("hides each present section once and records it", async () => {
    const store = memoryStore();
    const sections = explorer([OPEN_EDITORS_WIDGET_ID, NPM_SCRIPTS_WIDGET_ID, "files"]);
    expect(await hideSectionsOnce(store, sections)).toEqual([OPEN_EDITORS_WIDGET_ID, NPM_SCRIPTS_WIDGET_ID]);
    expect(sections.hidden).toEqual([OPEN_EDITORS_WIDGET_ID, NPM_SCRIPTS_WIDGET_ID]);
    expect(store.value).toEqual([OPEN_EDITORS_WIDGET_ID, NPM_SCRIPTS_WIDGET_ID]);
  });

  it("is idempotent: a second run, and a later launch, hide nothing, so a section the user showed stays shown", async () => {
    const store = memoryStore();
    const sections = explorer([OPEN_EDITORS_WIDGET_ID, NPM_SCRIPTS_WIDGET_ID]);
    await hideSectionsOnce(store, sections);
    expect(await hideSectionsOnce(store, sections)).toEqual([]);
    expect(await hideSectionsOnce(store, explorer([OPEN_EDITORS_WIDGET_ID, NPM_SCRIPTS_WIDGET_ID]))).toEqual([]);
    expect(sections.hidden).toEqual([OPEN_EDITORS_WIDGET_ID, NPM_SCRIPTS_WIDGET_ID]);
  });

  it("leaves a section that is not there yet for a later run: NPM Scripts attaches after the layout", async () => {
    const store = memoryStore();
    const sections = explorer([OPEN_EDITORS_WIDGET_ID]);
    expect(await hideSectionsOnce(store, sections)).toEqual([OPEN_EDITORS_WIDGET_ID]);
    expect(store.value).toEqual([OPEN_EDITORS_WIDGET_ID]);
    sections.present.push(NPM_SCRIPTS_WIDGET_ID);
    expect(await hideSectionsOnce(store, sections)).toEqual([NPM_SCRIPTS_WIDGET_ID]);
    expect(store.value).toEqual([OPEN_EDITORS_WIDGET_ID, NPM_SCRIPTS_WIDGET_ID]);
    expect(await hideSectionsOnce(store, sections)).toEqual([]);
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
