import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STATUS_DATA, STATUS_LIVE, statusClass } from "./status-dock.js";

describe("statusClass", () => {
  it("joins the hooks an entry asks for", () => {
    expect(statusClass({ data: true })).toBe(STATUS_DATA);
    expect(statusClass({ live: true })).toBe(STATUS_LIVE);
    expect(statusClass({ data: true, live: true })).toBe(`${STATUS_DATA} ${STATUS_LIVE}`);
  });

  // Theia appends a truthy className to the element's classes: the empty
  // string adds nothing.
  it("is empty when the entry is neither", () => {
    expect(statusClass({})).toBe("");
    expect(statusClass({ data: false, live: false })).toBe("");
  });
});

// Each of spexr's status entries carries its hook; the contributions need
// Theia to run, so their sources are read.
describe("spexr's status entries", () => {
  const read = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

  it.each([
    ["../scm/git-status-bar-contribution.ts", "className: STATUS_DATA,"],
    ["../resources/resource-status-bar-contribution.ts", "className: STATUS_DATA,"],
    ["../project/project-status-bar-contribution.ts", "className: statusClass({ data: !!path }),"],
    ["../search/description-job-status-bar-contribution.ts", "className: statusClass({ live: entry.live }),"],
    ["../decision/decision-model-status-bar.ts", "className: statusClass({ live: downloadStatusLive(s) }),"],
  ])("%s sets %s", (file, hook) => {
    const source = read(file);
    const set = source.slice(source.indexOf("this.statusBar.setElement(ENTRY_ID, {"));
    expect(set.slice(0, set.indexOf("});")), file).toContain(hook);
  });
});
