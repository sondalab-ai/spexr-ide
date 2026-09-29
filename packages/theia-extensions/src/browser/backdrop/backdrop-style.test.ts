import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Declarations of every spexr.css rule whose selector list names `selector`. */
function declarationsFor(selector: string): string {
  const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) =>
      m[1]!
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(",\n")
        .some((s) => s.trim() === selector),
    )
    .map((m) => m[2]!)
    .join("\n");
}

const zIndex = (selector: string): number =>
  Number(/z-index:\s*(-?\d+)/.exec(declarationsFor(selector))?.[1]);

const STRIPS = ":is(.spexr-life-bg, .spexr-photo-bg)";

// Both backdrops share one zero-height sticky strip under the panel content;
// the photo's credit gets its own strip above the content, so its links take
// clicks while the rest of the panel stays the content's.
describe("backdrop CSS", () => {
  it("gives both backdrops the same sticky strip that takes no clicks", () => {
    const strip = declarationsFor(STRIPS);
    expect(strip).toMatch(/position:\s*sticky/);
    expect(strip).toMatch(/height:\s*0/);
    expect(strip).toMatch(/pointer-events:\s*none/);
  });

  it("keeps the backdrop under the content and the credit above it", () => {
    const content = zIndex(`${STRIPS} ~ :is(.spexr-df-shell, .spexr-spec-panel)`);
    expect(zIndex(STRIPS)).toBeLessThan(content);
    expect(zIndex(".spexr-photo-bg--credit")).toBeGreaterThan(content);
  });

  it("lets only the credit's links take clicks", () => {
    expect(declarationsFor(".spexr-photo-bg__credit")).not.toMatch(/pointer-events/);
    expect(declarationsFor(".spexr-photo-bg__credit a")).toMatch(/pointer-events:\s*auto/);
  });

  it("hides both backdrops, and so the credit, in high contrast", () => {
    expect(declarationsFor(`[data-sl-theme="high-contrast"] ${STRIPS}`)).toMatch(/display:\s*none/);
  });

  it("prints the photo faintly, in the accent, in either theme", () => {
    const dark = declarationsFor(".spexr-photo-bg__canvas");
    expect(dark).toMatch(/color:\s*var\(--sl-accent-default\)/);
    const opacity = (block: string): number => Number(/opacity:\s*([\d.]+)/.exec(block)?.[1]);
    expect(opacity(dark)).toBeGreaterThan(0);
    expect(opacity(dark)).toBeLessThan(0.3);
    const light = opacity(declarationsFor('[data-sl-theme="light"] .spexr-photo-bg__canvas'));
    expect(light).toBeGreaterThan(0);
    expect(light).toBeLessThan(0.3);
  });
});
