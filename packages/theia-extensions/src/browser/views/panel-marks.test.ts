import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PanelHead } from "./panel-head.js";
import { PANEL_MARK_GLYPHS, PANEL_MARKS, panelMarkClass, type PanelMarkKey } from "./panel-marks.js";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Every view that opens with a PanelHead, by its mark key, in tab order. */
const SOURCES: Record<PanelMarkKey, string> = {
  agent: "../agent-pane/agent-pane-view.tsx",
  memory: "./memory-widget.tsx",
  experts: "./experts-widget.tsx",
  todo: "../todo/todo-widget.tsx",
};

describe("the right island's eyebrow glyphs", () => {
  it("gives every view one of the kit's glyphs, and no two views the same", () => {
    const glyphs = Object.values(PANEL_MARKS);
    for (const glyph of glyphs) expect(PANEL_MARK_GLYPHS).toContain(glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("wears the bare mark alone and a glyph modifier with the mark", () => {
    expect(panelMarkClass("agent")).toBe("sl-eyebrow sl-eyebrow--mark");
    expect(panelMarkClass("memory")).toBe("sl-eyebrow sl-eyebrow--mark sl-eyebrow--mark-square");
    expect(panelMarkClass("experts")).toBe("sl-eyebrow sl-eyebrow--mark sl-eyebrow--mark-circle");
    expect(panelMarkClass("todo")).toBe("sl-eyebrow sl-eyebrow--mark sl-eyebrow--mark-tri");
  });

  it("puts the view's glyph on the head's eyebrow, with or without an aside", () => {
    const plain = renderToStaticMarkup(React.createElement(PanelHead, { eyebrow: "Memory", mark: "memory" }));
    expect(plain).toContain('<p class="sl-eyebrow sl-eyebrow--mark sl-eyebrow--mark-square spexr-panel-head__eyebrow">Memory</p>');
    const aside = renderToStaticMarkup(
      React.createElement(PanelHead, { eyebrow: "Agent", mark: "agent", title: "t", aside: React.createElement("span") }),
    );
    expect(aside).toContain('<p class="sl-eyebrow sl-eyebrow--mark spexr-panel-head__eyebrow">Agent</p>');
  });

  // A view with two heads (loading and live, or empty and listed) keeps one glyph across its states.
  it.each(Object.entries(SOURCES))("%s passes its own key on every head", (key, file) => {
    const src = read(file);
    // Assumes no prop value of a head contains "/>": the first one ends the head.
    const heads = src.match(/<PanelHead\b[\s\S]*?\/>/g) ?? [];
    expect(heads.length, key).toBe(src.split("<PanelHead").length - 1);
    expect(heads.length, key).toBeGreaterThan(0);
    for (const head of heads) expect(head, key).toContain(`mark="${key}"`);
  });
});
