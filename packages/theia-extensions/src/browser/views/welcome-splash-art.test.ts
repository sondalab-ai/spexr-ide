import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WelcomeSplash } from "./welcome-splash.js";

const noop = (): void => undefined;
const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `selector { declarations }` pair of spexr.css, comments stripped, selectors whitespace-collapsed. */
const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim().replace(/\s+/g, " "), body: m[2]! }));

describe("the welcome splash's poster", () => {
  it("is the kit's stair poster, once, hidden from assistive tech", () => {
    const html = renderToStaticMarkup(React.createElement(WelcomeSplash, { onNewProject: noop, onOpenFolder: noop, onFocusAgent: noop }));
    const posters = html.match(/<div class="sl-art-poster[^"]*"[^>]*>/g) ?? [];
    expect(posters).toEqual(['<div class="sl-art-poster sl-art-poster--stair spexr-welcome__poster" aria-hidden="true">']);
  });

  // The kit paints no art there but keeps the box, which would leave an empty column.
  it("drops the poster's box under the high-contrast theme", () => {
    const rule = RULES.find((r) => r.selector === ':root[data-sl-theme="high-contrast"] .spexr-welcome__poster');
    expect(rule).toBeDefined();
    expect(rule!.body).toMatch(/display:\s*none/);
  });

  it("drops the poster's box under forced colours", () => {
    expect(css).toMatch(/@media \(forced-colors: active\)\s*\{\s*\.spexr-welcome__poster\s*\{[^}]*display:\s*none/);
  });
});
