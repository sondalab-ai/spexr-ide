/**
 * The bundled VS Code builtins are deployed and live.
 *
 * Regression test for the plugin path: the fixture once pointed the deployer
 * at `local-dir:plugins`, which resolved against apps/desktop and found
 * nothing, so every launch ran with zero extensions and the suite still
 * passed. Without the builtins Monaco has no TypeScript grammar and every
 * token of a `.ts` file renders with the one default class, `mtk1`; with
 * them, keywords, strings and comments each get their own.
 */
import path from "path";
import fs from "fs";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/app.js";

const SAMPLE = [
  "// a comment, a keyword, a string and a number: four token colours",
  "export const answer: number = 42;",
  'export function greet(name: string): string { return "hi " + name; }',
  "",
].join("\n");

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
  test("a TypeScript file is highlighted by the builtin grammar", async ({ page, workspace }) => {
    fs.writeFileSync(path.join(workspace, "sample.ts"), SAMPLE, "utf8");

    // Quick Open from the page body: a key pressed while focus sits in a
    // webview never reaches Theia's keybindings.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press(process.platform === "darwin" ? "Meta+P" : "Control+P");
    const input = page.locator(".quick-input-widget input.input");
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.fill("sample.ts");
    await page
      .locator(".quick-input-list .monaco-list-row", { hasText: "sample.ts" })
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.keyboard.press("Enter");

    await expect
      .poll(() => tokenClasses(page, "greet"), {
        message: "tokens of sample.ts (one class means no grammar, so no builtins)",
        timeout: 30_000,
      })
      .toEqual(expect.arrayContaining([expect.stringMatching(/^mtk(?!1$)\d+$/)]));
  });
});
