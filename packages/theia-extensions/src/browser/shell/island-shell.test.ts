import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const theiaShell = readFileSync(createRequire(import.meta.url).resolve("@theia/core/lib/browser/shell/application-shell.js"), "utf8");
const ours = readFileSync(fileURLToPath(new URL("./island-shell.ts", import.meta.url)), "utf8");

/** The body of a method of Theia's ApplicationShell class, from its compiled source. */
function method(signature: string): string {
  const start = theiaShell.indexOf(`\n    ${signature} {`);
  expect(start, `ApplicationShell.${signature}`).toBeGreaterThanOrEqual(0);
  return theiaShell.slice(start, theiaShell.indexOf("\n    }\n", start));
}

// SpexrApplicationShell lays the islands' gaps out by overriding only
// createSplitLayout. If a Theia upgrade stops building the shell's two splits
// through it, or stops hard-coding their spacing, the gaps vanish with no
// error: the islands render flush. This guard fails first.
describe("Theia's shell layout, which the island shell relies on", () => {
  it("builds its two splits through createSplitLayout, each with a spacing of 0", () => {
    const calls = [...method("createLayout()").matchAll(/this\.createSplitLayout\(([^;]*)\);/g)].map((m) => m[1]!);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call, call).toMatch(/spacing: 0\b/);
  });

  it("still has the overridable createSplitLayout(widgets, stretch, options)", () => {
    expect(method("createSplitLayout(widgets, stretch, options)")).toMatch(/new widgets_1\.SplitLayout\(optParam\)/);
  });

  it("is overridden to pass the island gap as the spacing", () => {
    expect(ours).toMatch(/protected override createSplitLayout\(/);
    expect(ours).toMatch(/return super\.createSplitLayout\(widgets, stretch, islandSplitOptions\(options\)\);/);
  });
});
