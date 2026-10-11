import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import URI from "@theia/core/lib/common/uri";
import { OUTLINE_FOLDER_CLASS, OUTLINE_GLYPH, OUTLINE_ICON_CLASS, OUTLINE_ICON_THEME_ID, handlesElement, outlineCanHandle, outlineIconClass, outlineKindOf } from "./outline-icons.js";

const own = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

describe("the outline icon theme's mapping (S6f, D10)", () => {
  it("draws a file stat by what it is: a directory a folder, anything else a file", () => {
    expect(outlineKindOf({ isDirectory: true })).toBe("folder");
    expect(outlineKindOf({ isDirectory: false })).toBe("file");
    expect(outlineKindOf({})).toBe("file");
  });

  it("draws an icon reference by its id, and a bare URI as a file", () => {
    expect(outlineKindOf({ kind: "uriIconReference", id: "folder" })).toBe("folder");
    expect(outlineKindOf({ kind: "uriIconReference", id: "file" })).toBe("file");
    expect(outlineKindOf({ kind: "uriIconReference" })).toBe("file");
  });

  it("gives a file the codicon file and a folder the codicon folder, both with the theme's hook, and only the folder its marker", () => {
    expect(outlineIconClass("file")).toBe(`codicon codicon-file ${OUTLINE_ICON_CLASS}`);
    expect(outlineIconClass("folder")).toBe(`codicon codicon-folder ${OUTLINE_ICON_CLASS} ${OUTLINE_FOLDER_CLASS}`);
    expect(outlineIconClass("file")).not.toContain(OUTLINE_FOLDER_CLASS);
  });

  it("names no file type: one glyph for every file, so nothing but the muted ink and the accent is drawn", () => {
    expect(outlineIconClass("file")).not.toMatch(/ts|json|md|-icon-/);
  });
});

describe("what the theme draws (S6f)", () => {
  it("is a file or folder on disk: a file: URI, a file: stat, an icon reference with a file: URI or none", () => {
    expect(handlesElement({ kind: "uri", scheme: "file" })).toBe(true);
    expect(handlesElement({ kind: "fileStat", scheme: "file" })).toBe(true);
    expect(handlesElement({ kind: "iconReference" })).toBe(true);
    expect(handlesElement({ kind: "iconReference", scheme: "file" })).toBe(true);
  });

  it("is not a diff, untitled, git or AI-variable URI, nor an element that is none of these", () => {
    for (const scheme of ["diff", "untitled", "git", "ai-variable", "vscode-remote"]) {
      expect(handlesElement({ kind: "uri", scheme }), scheme).toBe(false);
      expect(handlesElement({ kind: "fileStat", scheme }), scheme).toBe(false);
      expect(handlesElement({ kind: "iconReference", scheme }), scheme).toBe(false);
    }
    expect(handlesElement({ kind: "other" })).toBe(false);
  });

  it("pins the glyphs the two codicon classes draw", () => {
    expect(OUTLINE_GLYPH.file).toBe("\uea7b");
    expect(OUTLINE_GLYPH.folder).toBe("\uea83");
  });
});

describe("the theme's answer (S6f)", () => {
  const file = new URI("file:///ws/src/resolve.ts");
  const folder = { kind: "uriIconReference", id: "folder" };

  it("answers for nothing until it is the active theme, and then only for files and folders on disk", () => {
    expect(outlineCanHandle(file, false)).toBe(0);
    expect(outlineCanHandle(file, true)).toBeGreaterThan(0);
    expect(outlineCanHandle(folder, true)).toBeGreaterThan(0);
    expect(outlineCanHandle({ kind: "uriIconReference", id: "file", uri: file }, true)).toBeGreaterThan(0);
    expect(outlineCanHandle({ resource: file, isDirectory: true }, true)).toBeGreaterThan(0);
  });

  it("leaves a diff tab's icon, an untitled file and an AI variable to their own providers", () => {
    // A diff URI is `diff:` with both sides in its query (DiffUris.encode).
    expect(outlineCanHandle(new URI("diff:?left=file%3A%2F%2F%2Fws%2Fa.ts&right=file%3A%2F%2F%2Fws%2Fb.ts"), true)).toBe(0);
    expect(outlineCanHandle(new URI("untitled:Untitled-1"), true)).toBe(0);
    expect(outlineCanHandle(new URI("ai-variable:/ctx/selection"), true)).toBe(0);
    expect(outlineCanHandle({ kind: "uriIconReference", id: "file", uri: new URI("git:/ws/a.ts") }, true)).toBe(0);
    expect(outlineCanHandle({ resource: new URI("untitled:x"), isDirectory: false }, true)).toBe(0);
    expect(outlineCanHandle({ some: "node" }, true)).toBe(0);
  });

  it("is the theme's own answer: the class delegates, and is a file icon theme and a label provider in one", () => {
    const source = own("./outline-icon-theme.ts");
    expect(source).toContain("return outlineCanHandle(element, !this.toDeactivate.disposed);");
    expect(source).toContain("implements IconTheme, LabelProviderContribution, IconThemeContribution");
    expect(source).toContain("readonly hasFileIcons = true;");
    expect(source).toContain("readonly hasFolderIcons = true;");
  });

  it("is the default theme, and the others stay registered: it is added beside Theia's, not instead", () => {
    const desktop = JSON.parse(own("../../../../../apps/desktop/package.json")) as { theia: { frontend: { config: { preferences: Record<string, unknown> } } } };
    expect(desktop.theia.frontend.config.preferences["workbench.iconTheme"]).toBe(OUTLINE_ICON_THEME_ID);
    const module = own("../spexr-frontend-module.ts");
    expect(module).toContain("bind(IconThemeContribution).toService(SpexrOutlineIconTheme)");
    expect(module).toContain("bind(LabelProviderContribution).toService(SpexrOutlineIconTheme)");
    expect(module).not.toMatch(/unbind\(IconThemeContribution|rebind\(IconThemeContribution/);
  });

  it("agrees with the diff URI Theia builds", () => {
    expect(readFileSync(fileURLToPath(new URL("../../../../../node_modules/@theia/core/src/browser/diff-uris.ts", import.meta.url)), "utf8")).toContain("withScheme(DIFF_SCHEME)");
  });
});
