import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The declarations of the first rule whose selector is exactly `selector` in spexr.css. */
function rule(selector: string): string {
  const css = readFileSync(fileURLToPath(new URL("../../style/spexr.css", import.meta.url)), "utf8");
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

// The sidebar sat inside the wall's padding and scrolled away with the wall.
// The wall column scrolls on its own now; the sidebar beside it is a
// full-height column, flush to the top, with its own scroll.
describe(".spexr-sched", () => {
  it("stays put beside a wall column that scrolls on its own", () => {
    expect(rule(".spexr-darkfactory")).toMatch(/overflow:\s*hidden/);
    expect(rule(".spexr-df-shell")).toMatch(/height:\s*100%/);
    const wall = rule(".spexr-df-shell > .spexr-df-root");
    expect(wall).toMatch(/overflow-y:\s*auto/);
    expect(wall).toMatch(/padding:\s*var\(--sl-space-4\)/);
    const sched = rule(".spexr-sched");
    expect(sched).toMatch(/overflow-y:\s*auto/);
    expect(sched).not.toMatch(/position:\s*sticky|margin:/);
  });

  it("lets the backdrop through like the new-session launcher", () => {
    expect(rule(".spexr-sched")).toMatch(/background:\s*color-mix\([^;]*transparent\)/);
  });
});

// Centred on label + select, the icon buttons floated above the select.
describe(".spexr-sched__picker", () => {
  it("bottom-aligns its buttons with a select of the same height", () => {
    expect(rule(".spexr-sched__picker")).toMatch(/align-items:\s*flex-end/);
    expect(rule(".spexr-sched__picker .sl-field__input")).toMatch(/height:\s*var\(--df-control-height\)/);
  });
});

// Fields inside "Model and permissions" touched each other and the summary.
describe(".spexr-sched__advanced", () => {
  it("spaces the summary and the fields it reveals", () => {
    expect(rule(".spexr-sched__advanced[open] > summary")).toMatch(/margin-bottom:\s*var\(--sl-space-3\)/);
    expect(rule(".spexr-sched__advanced > :not(summary) + :not(summary)")).toMatch(/margin-top:\s*var\(--sl-space-3\)/);
  });
});

describe("the danger icon button", () => {
  it("draws a danger icon button in the danger colour", () => {
    expect(rule(".sl-icon-btn--danger")).toMatch(/color:\s*var\(--slc-danger\)/);
  });
});

// With every other button filled, a bare danger button read as disabled.
describe("danger buttons", () => {
  it("carry a danger tint at rest", () => {
    for (const sel of [".sl-btn--danger", ".sl-icon-btn--danger"]) {
      expect(rule(sel)).toMatch(/background:\s*color-mix\(in srgb, var\(--slc-danger\) 14%, transparent\)/);
    }
  });
});

// Icon-only buttons each had a bespoke look (transparent, outlined, round).
// They now share the kit icon button, so their own rules keep layout only.
describe("icon-only buttons", () => {
  it.each([
    ".spexr-df-refresh",
    ".spexr-df-launcher__browse",
    ".spexr-df-pinned__close",
    ".spexr-df-browser__icon",
    ".spexr-df-group__toggle",
    ".spexr-df-search__clear",
    ".spexr-smart-search__map-regen",
    ".spexr-scm-input__generate",
  ])("%s leaves background, border and colour to the kit", (sel) => {
    expect(rule(sel)).not.toMatch(/(^|[\s;{])(background|border|color):/);
  });
});
