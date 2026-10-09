import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { colorsName } from "./decoration-name-colour.js";
import { decorationForFile } from "./git-state-decoration-format.js";

describe("which decorations colour a row's name (S6b, L7)", () => {
  it("leaves the name of a changed file in the row's ink: every git state's colour is the letter's alone", () => {
    for (const state of ["A", "M", "D", "R", "C", "U", "?"] as const) {
      const decoration = decorationForFile({ path: "f.ts", unstagedState: state });
      expect(decoration?.colorId, state).toBeDefined();
      expect(colorsName(decoration?.colorId), state).toBe(false);
    }
  });

  it("keeps the dimming of an ignored name, which has no letter to carry it", () => {
    expect(colorsName("disabledForeground")).toBe(true);
  });

  it("colours nothing for a decoration without a colour", () => {
    expect(colorsName(undefined)).toBe(false);
  });
});

describe("the file tree's adapter learns decorations it was not told of (S6b, L7)", () => {
  it("because Theia's learns them only from change events, which an Explorer created later has missed", () => {
    const theia = readFileSync(createRequire(import.meta.url).resolve("@theia/filesystem/lib/browser/file-tree/file-tree-decorator-adapter.js"), "utf8");
    expect(theia).toMatch(/this\.decorationsService\.onDidChangeDecorations\(newDecorations => \{\s*this\.updateDecorations\(this\.decorationsByUri\.keys\(\), newDecorations\.keys\(\)\);/);
    expect(theia).toMatch(/decorations\(tree\) \{\s*return this\.collectDecorations\(tree\);/);
    const own = readFileSync(fileURLToPath(new URL("./spexr-file-tree-decorator-adapter.ts", import.meta.url)), "utf8");
    expect(own).toMatch(/this\.learnMissing\(tree\);\s*return super\.decorations\(tree\);/);
    expect(own).toContain("this.updateDecorations(this.decorationsByUri.keys(), found.values());");
  });
});
