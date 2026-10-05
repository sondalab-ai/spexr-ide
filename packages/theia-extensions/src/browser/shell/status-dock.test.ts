import { describe, expect, it } from "vitest";
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
