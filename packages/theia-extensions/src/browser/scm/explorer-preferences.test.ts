import { describe, expect, it } from "vitest";
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
