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
 * The file is opened through the Spec panel's Open button, the route the
 * other spec tests use, not through Quick Open: a keystroke depends on where
 * focus is, and a view revealed late at startup can take it, which closed
 * Quick Open before it could be used (run 37309709605).
 */
import path from "path";
import fs from "fs";
import type { Page } from "@playwright/test";
import { test, expect, openFileInEditor } from "../fixtures/app.js";

const MARKER = "Builtin grammar check";
const SPEC = `---
slug: 0003-builtins
title: Builtins
status: draft
createdAt: 2026-01-01
---

## ${MARKER}

A paragraph with **bold**, *emphasis* and \`code\`.

- **AC-1** The grammar colours this file.
`;

/** Distinct `mtkN` token classes in the visible editor that shows `marker`. */
async function tokenClasses(page: Page, marker: string): Promise<string[]> {
  return page.evaluate((text) => {
    const editor = [...document.querySelectorAll<HTMLElement>(".monaco-editor")].find(
      (e) => e.getBoundingClientRect().width > 0 && (e.querySelector(".view-lines")?.textContent ?? "").includes(text),
    );
    if (!editor) return [];
    const classes = new Set<string>();
    for (const span of editor.querySelectorAll(".view-lines span[class*='mtk']")) {
      for (const c of span.classList) if (/^mtk\d+$/.test(c)) classes.add(c);
    }
    return [...classes].sort();
  }, marker);
}

test.describe("VS Code builtins", () => {
  test("a spec file is highlighted by the builtin Markdown grammar", async ({ page, workspace }) => {
    const file = path.join(workspace, "docs/specs/0003-builtins.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, SPEC, "utf8");
    await openFileInEditor(page, "0003-builtins.md");

    // [] means the spec never reached an editor; ["mtk1"] means it did, with no grammar.
    await expect
      .poll(() => tokenClasses(page, MARKER), {
        message: "token classes of the spec in the editor: [] = not opened, only mtk1 = no builtin grammar",
        timeout: 30_000,
      })
      .toEqual(expect.arrayContaining([expect.stringMatching(/^mtk(?!1$)\d+$/)]));
  });
});
