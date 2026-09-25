import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Kit components that draw their own ::before or ::after (components.css).
 * The effect families paint on those pseudo-elements too, so on the same
 * element the two rules collide: on .sl-select the aurora ring took the
 * chevron's place and size, showing a small circle and no arrow. The kit's
 * rule is to put the effect on a wrapper around the component.
 */
const SELF_DRAWN = [
  "sl-badge", "sl-callout", "sl-check__box", "sl-monogram", "sl-radio__box",
  "sl-rule--labeled", "sl-select", "sl-switch__track", "sl-tag", "sl-tooltip",
];

const BROWSER = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.includes(".test.") ? [join(dir, e.name)] : [],
  );
}

/** Every string literal that holds an `sl-fx-` class, with where it is. */
function fxClassLists(): Array<{ where: string; classes: string[] }> {
  const out: Array<{ where: string; classes: string[] }> = [];
  for (const file of sources(BROWSER)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/["'`]([^"'`\n]*\bsl-fx-[^"'`\n]*)["'`]/g)) {
      const line = text.slice(0, m.index).split("\n").length;
      out.push({ where: `${file.slice(BROWSER.length)}:${line}`, classes: m[1]!.split(/\s+/) });
    }
  }
  return out;
}

describe("sl-fx-* class placement", () => {
  it("finds the effect classes it is meant to check", () => {
    expect(fxClassLists().length).toBeGreaterThan(0);
  });

  it("never puts an effect on a kit component that draws its own pseudo-elements", () => {
    const clashes = fxClassLists()
      .filter(({ classes }) => classes.some((c) => SELF_DRAWN.includes(c)))
      .map(({ where }) => where);
    expect(clashes).toEqual([]);
  });
});
