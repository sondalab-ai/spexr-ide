import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_GUTTER,
  GEIST_MONO_ADVANCE_EM,
  GUTTER_TOLERANCE_PX,
  MONACO_FOLDING_WIDTH,
  SPEXR_GUTTER_OPTIONS,
  gutterLayout,
  withSpexrGutter,
} from "./spexr-editor-gutter.js";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const read = (path: string): string => readFileSync(path, "utf8");
const repo = join(here, "../../../../..");

/** The editor font the demo sets: Geist Mono at 13px (S5a's preference). */
const DIGIT_WIDTH = GEIST_MONO_ADVANCE_EM * 13;

const layout = (digits: number, over: Partial<Parameters<typeof gutterLayout>[0]> = {}) =>
  gutterLayout({ digitWidth: DIGIT_WIDTH, digits, ...SPEXR_GUTTER_OPTIONS, folding: true, glyphMarginWidth: 0, ...over });

describe("the editor gutter", () => {
  it("ends the line numbers within 2px of +38 and starts the text at +56, for files up to 99999 lines", () => {
    for (const digits of [1, 2, 3, 4, 5]) {
      const { numbersRight, contentLeft } = layout(digits);
      expect(Math.abs(numbersRight - DEMO_GUTTER.numbersRight), `${digits} digits: numbers end ${numbersRight}`).toBeLessThanOrEqual(GUTTER_TOLERANCE_PX);
      expect(Math.abs(contentLeft - DEMO_GUTTER.contentLeft), `${digits} digits: text starts ${contentLeft}`).toBeLessThanOrEqual(GUTTER_TOLERANCE_PX);
    }
    expect(layout(2)).toEqual({ numbersRight: 39, contentLeft: 56 });
  });

  it("grows only past five digits, and then by one digit's width", () => {
    expect(layout(6).numbersRight).toBe(47);
    expect(layout(6).contentLeft - layout(6).numbersRight).toBe(layout(2).contentLeft - layout(2).numbersRight);
  });

  it("measures the digit as the demo does: 42 characters are 327.67px at 13px", () => {
    const regions = JSON.parse(read(join(repo, "tests/visual/reference/demo-regions.json"))) as {
      themes: { dark: { regions: Record<string, { items: Array<{ text: string; rect: { w: number } }> }> } };
    };
    const line = regions.themes.dark.regions["code.tx"]!.items[0]!;
    expect(line.text).toBe('import { Cache, Evidence } from "./cache";');
    expect(line.rect.w / line.text.length / 13).toBeCloseTo(GEIST_MONO_ADVANCE_EM, 2);
  });

  it("is off by the glyph margin when one is on, which is why the preference defaults to off", () => {
    expect(layout(2, { glyphMarginWidth: 22 }).numbersRight).toBe(61);
  });

  it("matches Monaco's own layout: the widths are rounded, folding adds 16", () => {
    const text = read(require.resolve("@theia/monaco-editor-core/esm/vs/editor/common/config/editorOptions.js"));
    expect(text).toMatch(/lineNumbersWidth = Math\.round\(digitCount \* maxDigitWidth\)/);
    expect(text).toMatch(/const digitCount = Math\.max\(lineNumbersDigitCount, lineNumbersMinChars\)/);
    expect(text).toMatch(/if \(folding && showFoldingDecoration\) \{\s*lineDecorationsWidth \+= 16;/);
    expect(text).toMatch(/let contentLeft = decorationsLeft \+ lineDecorationsWidth/);
    expect(MONACO_FOLDING_WIDTH).toBe(16);
    expect(text).toMatch(/glyphMarginWidth = lineHeight \* env\.glyphMarginDecorationLaneCount/);
  });
});

describe("the provider that sets the gutter", () => {
  const provider = read(join(require.resolve("@theia/monaco/lib/browser/monaco-editor-provider.js")));

  it("overrides the method Theia builds the options in, which sets lineNumbersMinChars from the model on every update", () => {
    expect(provider).toMatch(/createMonacoEditorOptions\(model\) \{/);
    expect(provider).toMatch(/options\.lineNumbersMinChars = model\.lineNumbersMinChars;/);
    // the update path without an event rebuilds all options through that method
    expect(provider).toMatch(/const options = this\.createMonacoEditorOptions\(editor\.document\);/);
    const ours = read(join(here, "spexr-monaco-editor-provider.ts"));
    expect(ours).toMatch(/extends MonacoEditorProvider/);
    expect(ours).toMatch(/protected override createMonacoEditorOptions\(model: MonacoEditorModel\)/);
    expect(ours).toMatch(/withSpexrGutter\(super\.createMonacoEditorOptions\(model\)\)/);
    // a diff editor builds its options in its own method, which is overridden the same way
    expect(provider).toMatch(/createMonacoDiffEditorOptions\(original, modified\) \{/);
    expect(provider).toMatch(/const options = this\.createMonacoDiffEditorOptions\(originalModel, modifiedModel\);/);
    expect(ours).toMatch(/protected override createMonacoDiffEditorOptions\(original: MonacoEditorModel, modified: MonacoEditorModel\)/);
    expect(ours).toMatch(/withSpexrGutter\(super\.createMonacoDiffEditorOptions\(original, modified\)\)/);
  });

  it("is bound over Theia's, in the module that loads after @theia/monaco's", () => {
    const module = read(join(here, "../spexr-frontend-module.ts"));
    expect(module).toMatch(/rebind\(MonacoEditorProvider\)\.to\(SpexrMonacoEditorProvider\)\.inSingletonScope\(\)/);
    expect(read(require.resolve("@theia/monaco/lib/browser/monaco-frontend-module.js"))).toMatch(/bind\(monaco_editor_provider_1\.MonacoEditorProvider\)\.toSelf\(\)/);
  });

  // Stands in for Theia's options (a model's lineNumbersMinChars is 3): both
  // the editor's and the diff editor's come out with the gutter laid over.
  it("lays the gutter over an editor's options and a diff editor's, over what Theia set", () => {
    const editor = withSpexrGutter({ lineNumbersMinChars: 3, readOnly: false });
    const diff = withSpexrGutter({ originalEditable: true, lineNumbersMinChars: 3 });
    for (const options of [editor, diff]) {
      expect(options.lineNumbersMinChars).toBe(5);
      expect(options.lineDecorationsWidth).toBe(1);
    }
    expect(editor.readOnly).toBe(false);
    expect(diff.originalEditable).toBe(true);
  });

  it("sets two options, both known to Monaco's editor options", () => {
    expect(Object.keys(SPEXR_GUTTER_OPTIONS).sort()).toEqual(["lineDecorationsWidth", "lineNumbersMinChars"]);
    const text = read(require.resolve("@theia/monaco-editor-core/esm/vs/editor/common/config/editorOptions.js"));
    expect(text).toMatch(/'lineDecorationsWidth', 10\)/);
    expect(text).toMatch(/'lineNumbersMinChars', 5,/);
  });
});
