/**
 * TC-ISLANDS — Lumen islands smoke test (S3)
 *
 * The shell's left, main, bottom and right areas are islands, and the one that
 * holds the focus carries `data-lit`. The unit tests drive the lit tracking
 * with a fake shell; this is the one check against Theia's real focus tracker
 * and Lumino's layout: focus an editor, then the Explorer, then a terminal,
 * and after each step exactly one island is lit, the right one.
 */
import path from "path";
import fs from "fs";
import { test, expect, openFileInEditor } from "../fixtures/app.js";
import type { Page } from "@playwright/test";

const SPEC_CONTENT = `---
slug: 0001-islands
title: Islands
status: in-progress
createdAt: 2026-01-01
---

## Goal

Light the island that holds the focus.
`;

/** The `data-island` of every lit island, in DOM order. */
async function litIslands(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".spexr-island[data-lit]")].map((el) => el.dataset.island ?? "?"),
  );
}

/** Wait until exactly one island is lit, and it is `area`. */
async function expectLit(page: Page, area: "main" | "left" | "bottom" | "right"): Promise<void> {
  await expect.poll(() => litIslands(page), { timeout: 15_000 }).toEqual([area]);
}

/**
 * Put the focus in the Explorer's file tree. When the tree is not showing,
 * Theia's Explorer toggle (ctrlcmd+shift+e) opens and activates it; it would
 * collapse the panel only if the Explorer were already the visible view, which
 * the check rules out. The tree is given time to render first, so an Explorer
 * that is in front but not yet in the DOM is not collapsed by mistake. The
 * click lands below the tree's rows, so it opens nothing.
 */
async function focusExplorer(page: Page): Promise<void> {
  const tree = page.locator("#theia-left-content-panel #files .theia-TreeContainer");
  // An Explorer that was never opened stays absent: the toggle then opens it.
  await tree.waitFor({ state: "attached", timeout: 15_000 }).catch(() => undefined);
  if (!(await tree.isVisible().catch(() => false))) {
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await tree.waitFor({ state: "visible", timeout: 10_000 });
  }
  const box = await tree.boundingBox();
  if (!box) throw new Error("the Explorer's tree has no box");
  await tree.click({ position: { x: Math.min(40, box.width / 2), y: Math.max(1, box.height - 8) } });
}

test.describe("Lumen islands", () => {
  test("lights exactly the island that holds the focus", async ({ page, workspace }) => {
    // The shell's four areas are islands.
    await expect(page.locator(".spexr-island")).toHaveCount(4);
    for (const area of ["left", "main", "bottom", "right"]) {
      await expect(page.locator(`.spexr-island.sl-pane[data-island="${area}"]`)).toHaveCount(1);
    }

    // An editor in the main area.
    fs.writeFileSync(path.join(workspace, "docs/specs/0001-islands.md"), SPEC_CONTENT, "utf8");
    await openFileInEditor(page, "0001-islands.md");
    await page
      .locator("#theia-main-content-panel .theia-editor .monaco-editor .view-lines")
      .filter({ visible: true })
      .first()
      .click();
    await expectLit(page, "main");

    // The Explorer, in the left island.
    await focusExplorer(page);
    await expectLit(page, "left");

    // A new terminal (Theia's ctrl+shift+`). It docks beside the last-used
    // terminal, which may be the Claude terminal in the left or main island,
    // so its island is not fixed: the one lit island must be the island that
    // holds the focus, and the focus must be in the terminal.
    await page.keyboard.press("Control+Shift+Backquote");
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const active = document.activeElement;
            const lit = [...document.querySelectorAll<HTMLElement>(".spexr-island[data-lit]")].map((el) => el.dataset.island);
            const focused = active?.closest<HTMLElement>(".spexr-island")?.dataset.island;
            return { oneLit: lit.length === 1, litIsFocused: lit[0] !== undefined && lit[0] === focused, inTerminal: !!active?.closest(".xterm") };
          }),
        { timeout: 15_000 },
      )
      .toEqual({ oneLit: true, litIsFocused: true, inTerminal: true });
  });
});
