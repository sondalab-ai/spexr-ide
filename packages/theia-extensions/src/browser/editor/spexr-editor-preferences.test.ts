import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repo = join(here, "../../../../..");

const defaults = (): Record<string, unknown> => {
  const pkg = JSON.parse(readFileSync(join(repo, "apps/desktop/package.json"), "utf8")) as {
    theia: { frontend: { config: { preferences: Record<string, unknown> } } };
  };
  return pkg.theia.frontend.config.preferences;
};

describe("the editor's preference defaults", () => {
  it("turns the minimap off", () => {
    expect(defaults()["editor.minimap.enabled"]).toBe(false);
  });

  it("pads the top of the editor by 12px, as the demo's code block does", () => {
    expect(defaults()["editor.padding.top"]).toBe(12);
  });

  it("has no glyph margin (the demo's gutter is the numbers and the text), and washes the whole current row", () => {
    expect(defaults()["editor.glyphMargin"]).toBe(false);
    expect(defaults()["editor.renderLineHighlight"]).toBe("all");
  });

  it("draws no rainbow brackets (the demo's are the code ink)", () => {
    expect(defaults()["editor.bracketPairColorization.enabled"]).toBe(false);
  });

  it("keeps the preferences the app already defaulted", () => {
    expect(defaults()["editor.cursorStyle"]).toBe("block");
    expect(defaults()["editor.wordWrap"]).toBe("on");
  });

  // A default for an id Theia does not know is ignored: read the installed schema.
  it("names preferences that Theia's editor schema has, with the value types used", () => {
    const schema = readFileSync(require.resolve("@theia/editor/lib/common/editor-generated-preference-schema.js"), "utf8");
    for (const id of ["editor.minimap.enabled", "editor.padding.top", "editor.glyphMargin", "editor.renderLineHighlight", "editor.folding", "editor.bracketPairColorization.enabled"]) {
      expect(schema, id).toContain(`"${id}": {`);
    }
    expect(/"editor\.padding\.top": \{\s+"type": "number"/.test(schema)).toBe(true);
    expect(/"editor\.minimap\.enabled": \{\s+"type": "boolean"/.test(schema)).toBe(true);
    expect(/"editor\.renderLineHighlight": \{[\s\S]*?"all"/.test(schema)).toBe(true);
  });

  it("reaches the editor as Monaco's padding option: Theia nests a dotted preference name by its dots", () => {
    const provider = readFileSync(require.resolve("@theia/monaco/lib/browser/monaco-editor-provider.js"), "utf8");
    expect(provider).toMatch(/names = optionName\.split\('\.'\)|doSetOption\(options, value, optionName\.split\('\.'\)\)/);
  });

  // S5a's preferences are in the stack: the capture takes them as shipped,
  // since a seed in tests/visual/prepare.ts would hide a regression in them.
  it("defaults the editor to the demo's 13px on 22px rows, and the capture does not seed them", () => {
    const prepare = readFileSync(join(repo, "tests/visual/prepare.ts"), "utf8");
    expect(defaults()["editor.fontSize"]).toBe(13);
    expect(defaults()["editor.lineHeight"]).toBe(22);
    expect(/"editor\.(fontSize|lineHeight)":/.test(prepare), "drop the editor.fontSize / editor.lineHeight seed in tests/visual/prepare.ts: the product defaults them").toBe(false);
  });
});
