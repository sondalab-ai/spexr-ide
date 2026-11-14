import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WelcomeSplash } from "./welcome-splash.js";

const noop = (): void => undefined;
const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// ui-kit 0.44 removed sl-art-poster--stair, which left an empty column beside the intro.
// The head is now the intro alone, with no art.
describe("the welcome splash's head", () => {
  it("wears no kit poster", () => {
    const html = renderToStaticMarkup(React.createElement(WelcomeSplash, { onNewProject: noop, onOpenFolder: noop, onFocusAgent: noop }));
    expect(html).not.toMatch(/sl-art-poster/);
  });

  it("keeps no rule for the removed poster column", () => {
    expect(css).not.toMatch(/spexr-welcome__poster|spexr-welcome-head/);
  });
});
