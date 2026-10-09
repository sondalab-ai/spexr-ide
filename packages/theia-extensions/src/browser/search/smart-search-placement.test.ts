import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const resolve = createRequire(import.meta.url).resolve;
const contribution = readFileSync(fileURLToPath(new URL("./smart-search-contribution.ts", import.meta.url)), "utf8");

describe("Smart Search's place (S6b, D6)", () => {
  it("is the Search view container: the id is the installed Theia's", () => {
    const factory = readFileSync(resolve("@theia/search-in-workspace/lib/browser/search-in-workspace-factory.js"), "utf8");
    expect(factory).toContain("exports.SEARCH_VIEW_CONTAINER_ID = 'search-view-container';");
    expect(contribution).toContain('export const SEARCH_VIEW_CONTAINER_ID = "search-view-container";');
  });

  it("adds the widget to the Search container, above the workspace search, and not to the Explorer", () => {
    expect(contribution).toMatch(/getOrCreateWidget<ViewContainer>\(SEARCH_VIEW_CONTAINER_ID\)/);
    expect(contribution).toMatch(/container\.addWidget\(widget, \{\s*order: -1,/);
    expect(contribution).not.toMatch(/getOrCreateWidget[^\n]*EXPLORER_VIEW_CONTAINER_ID/);
  });

  it("takes the widget out of an Explorer a stored layout still holds it in, before it makes the Search one", () => {
    const stale = contribution.indexOf("explorer.removeWidget(stale)");
    expect(stale).toBeGreaterThan(0);
    expect(contribution.indexOf("getOrCreateWidget<SmartSearchWidget>(SmartSearchWidget.ID)")).toBeGreaterThan(stale);
    expect(contribution).toMatch(/explorer instanceof ViewContainer && stale && explorer\.getPartFor\(stale\)/);
  });
});
