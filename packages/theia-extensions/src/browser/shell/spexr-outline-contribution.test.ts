import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Theia's browser modules need a DOM to load, so these read the sources.
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("SpexrOutlineViewContribution", () => {
  const src = read("./spexr-outline-contribution.ts");

  it("extends Theia's Outline contribution and overrides initializeLayout to open nothing", () => {
    expect(src).toMatch(/class SpexrOutlineViewContribution extends OutlineViewContribution/);
    const body = /override async initializeLayout\(\): Promise<void> \{([\s\S]*?)\n  \}/.exec(src);
    expect(body).not.toBeNull();
    expect(body![1]).not.toMatch(/openView|super\./);
  });

  it("replaces Theia's binding, so the one contribution every command and the view toggle use is this", () => {
    expect(read("../spexr-frontend-module.ts")).toMatch(/rebind\(OutlineViewContribution\)\.to\(SpexrOutlineViewContribution\)\.inSingletonScope\(\)/);
  });
});
