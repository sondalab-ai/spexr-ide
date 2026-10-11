import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OUTLINE_FOLDER_CLASS, OUTLINE_ICON_CLASS, OUTLINE_ICON_THEME_ID, outlineIconClass, outlineKindOf } from "./outline-icons.js";

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

describe("the theme as Theia sees it", () => {
  const theme = own("./outline-icon-theme.ts");

  it("is a file icon theme and a label provider in one, answering only while it is active", () => {
    expect(theme).toContain("implements IconTheme, LabelProviderContribution, IconThemeContribution");
    expect(theme).toContain("if (this.toDeactivate.disposed) return 0;");
    expect(theme).toContain("element instanceof URI || URIIconReference.is(element) || FileStat.is(element)");
    expect(theme).toContain("Number.MAX_SAFE_INTEGER - 1024");
    expect(theme).toContain("readonly hasFileIcons = true;");
    expect(theme).toContain("readonly hasFolderIcons = true;");
  });

  it("is the default theme, and the others stay registered: it is added beside Theia's, not instead", () => {
    const desktop = JSON.parse(own("../../../../../apps/desktop/package.json")) as { theia: { frontend: { config: { preferences: Record<string, unknown> } } } };
    expect(desktop.theia.frontend.config.preferences["workbench.iconTheme"]).toBe(OUTLINE_ICON_THEME_ID);
    const module = own("../spexr-frontend-module.ts");
    expect(module).toContain("bind(IconThemeContribution).toService(SpexrOutlineIconTheme)");
    expect(module).toContain("bind(LabelProviderContribution).toService(SpexrOutlineIconTheme)");
    expect(module).not.toMatch(/unbind\(IconThemeContribution|rebind\(IconThemeContribution/);
  });

  it("names the codicons the class strings use, and the glyphs the style sheet swaps in", () => {
    const codicons = readFileSync(fileURLToPath(new URL("../../../../../node_modules/@vscode/codicons/dist/codicon.css", import.meta.url)), "utf8");
    expect(codicons).toContain('.codicon-file:before { content: "\\ea7b" }');
    expect(codicons).toContain('.codicon-folder:before { content: "\\ea83" }');
    expect(codicons).toContain('.codicon-folder-opened:before { content: "\\eaf7" }');
  });
});
