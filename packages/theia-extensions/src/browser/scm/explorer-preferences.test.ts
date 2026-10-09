import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const desktop = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../apps/desktop/package.json", import.meta.url)), "utf8")) as {
  theia: { frontend: { config: { preferences: Record<string, unknown> } } };
};
const preferences = desktop.theia.frontend.config.preferences;

describe("the Explorer's default preferences (S6b, L7)", () => {
  it("leave problem marks off the file tree: a row's name and folders carry no error or warning colour or dot, only git's letter", () => {
    expect(preferences["problems.decorations.enabled"]).toBe(false);
  });

  it("keep the tree's indent at the geometry table's 16px", () => {
    expect(preferences["workbench.tree.indent"]).toBe(16);
  });
});

describe("the problem marks' source (S6b, L7)", () => {
  const read = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

  it("is a decorations-service provider that Theia checks no preference for, so spexr's subclass does", () => {
    const resolve = createRequire(import.meta.url).resolve;
    const theia = readFileSync(resolve("@theia/markers/lib/browser/problem/problem-decorations-provider.js"), "utf8");
    expect(theia).toContain("bubble: true,");
    expect(theia.slice(theia.indexOf("provideDecorations(uri, token)"), theia.indexOf("exports.ProblemDecorationsProvider"))).not.toContain("problems.decorations.enabled");
    const own = read("./spexr-problem-decorations-provider.ts");
    expect(own).toContain('gateProblemDecoration(this.problemPreferences["problems.decorations.enabled"], () => super.provideDecorations(uri, token))');
    expect(read("../spexr-frontend-module.ts")).toContain("rebind(ProblemDecorationsProvider).to(SpexrProblemDecorationsProvider)");
  });
});
