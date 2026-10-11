/**
 * The bundled VS Code builtins are deployed and live.
 *
 * Regression test for the plugin path: the fixture once pointed the deployer
 * at `local-dir:plugins`, which resolved against apps/desktop and found
 * nothing, so every launch ran with zero extensions and the suite still
 * passed. spexr registers no grammar of its own, so without the builtins
 * Monaco renders every token with the one default class, `mtk1`; with the
 * builtin Markdown grammar, headings and emphasis each get their own.
 *
 * The file is opened through the Spec panel's Open button, the click route
 * the other spec tests use, not through Quick Open: a keystroke depends on
 * where focus is, and a view revealed late at startup can take it (run
 * 37309709605). The spec opens in a plain Monaco editor, with spexr's preview
 * beside it; the check reads that editor's widget, found by its id (Theia's
 * `code-editor-opener:<uri>`), not by text: the editor can be short enough
 * that Monaco renders only the first lines (run 37313310197). Those are the
 * YAML frontmatter, which the Markdown grammar embeds and tokenizes.
 */
import path from "path";
import fs from "fs";
import type { Page } from "@playwright/test";
import { test, expect, openFileInEditor } from "../fixtures/app.js";

const FILE = "0003-builtins.md";
const SPEC = `---
slug: 0003-builtins
title: Builtins
status: draft
createdAt: 2026-01-01
---

## Builtin grammar check

A paragraph with **bold**, *emphasis* and \`code\`.

- **AC-1** The grammar colours this file.
`;

/**
 * Distinct `mtkN` token classes on the rendered lines of the visible editor
 * whose widget id names `file`, or null when no such editor is open. Any
 * element whose id names the file and holds a Monaco editor qualifies: the
 * tab and the spec preview name it too, but hold no editor.
 */
async function tokenClasses(page: Page, file: string): Promise<string[] | null> {
  return page.evaluate((name) => {
    const widget = [...document.querySelectorAll<HTMLElement>("[id]")].find(
      (w) => w.id.includes(name) && !!w.querySelector(".monaco-editor") && w.getBoundingClientRect().width > 0,
    );
    if (!widget) return null;
    const classes = new Set<string>();
    for (const span of widget.querySelectorAll(".monaco-editor .view-lines span[class*='mtk']")) {
      for (const c of span.classList) if (/^mtk\d+$/.test(c)) classes.add(c);
    }
    return [...classes].sort();
  }, file);
}

test.describe("VS Code builtins", () => {
  test("a spec file is highlighted by the builtin Markdown grammar", async ({ page, workspace }) => {
    const file = path.join(workspace, "docs/specs", FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, SPEC, "utf8");
    await openFileInEditor(page, FILE);

    // null: the spec never reached an editor; ["mtk1"]: it did, with no grammar.
    await expect
      .poll(() => tokenClasses(page, FILE), {
        message: `token classes in the editor of ${FILE}: null = no editor open, only mtk1 = no builtin grammar`,
        timeout: 30_000,
      })
      .toEqual(expect.arrayContaining([expect.stringMatching(/^mtk(?!1$)\d+$/)]));
  });
});
