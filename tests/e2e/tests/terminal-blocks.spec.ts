/**
 * TC-TERMINAL-BLOCKS: a shell terminal frames each command (S6l, D22).
 *
 * A new terminal runs the user's shell with spexr's integration scripts
 * (bash or zsh, chained after Theia's), and the terminal lays a block over
 * every command: a `true` and a `false` give an exit-0 block and an exit-1
 * block, each with its chip (time, duration, exit). Text a command prints
 * cannot forge a block: a finished mark with a made-up nonce (exit 7) is
 * printed with `printf`, and the block of that command still ends with the shell's own exit 0.
 */
import { test, expect } from "../fixtures/app.js";
import type { Page } from "@playwright/test";

interface BlockRead {
  readonly exit: string | null;
  readonly framed: string | null;
  readonly chip: string;
}

/** The blocks in the terminal that holds the focus. */
async function blocks(page: Page): Promise<BlockRead[]> {
  return page.evaluate(() => {
    const xterm = document.activeElement?.closest(".xterm") ?? document.querySelector(".xterm");
    return [...(xterm?.querySelectorAll<HTMLElement>(".spexr-term-block") ?? [])].map((el) => ({
      exit: el.getAttribute("data-exit"),
      framed: el.getAttribute("data-frame"),
      chip: (el.querySelector(".spexr-term-block__meta")?.textContent ?? "").trim(),
    }));
  });
}

test.describe("TC-TERMINAL-BLOCKS: command blocks in a shell terminal", () => {
  test("a true and a false give an exit-0 and an exit-1 block, and printed text forges none", async ({ page }) => {
    // Theia's "new terminal": it takes the focus.
    await page.keyboard.press("Control+Shift+Backquote");
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".xterm")), { timeout: 15_000 }).toBe(true);
    // The shell sources its rc files and the integration before its first prompt.
    await page.waitForTimeout(4_000);

    await page.keyboard.type("true");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await blocks(page)).filter((b) => b.framed === "true").map((b) => b.exit), { timeout: 30_000 }).toEqual(["0"]);

    await page.keyboard.type("false");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await blocks(page)).filter((b) => b.framed === "true").map((b) => b.exit), { timeout: 30_000 }).toEqual(["0", "1"]);

    const finished = (await blocks(page)).filter((b) => b.framed === "true");
    expect(finished[0]!.chip).toMatch(/^\d{2}:\d{2}:\d{2}.*exit 0$/);
    expect(finished[1]!.chip).toMatch(/^\d{2}:\d{2}:\d{2}.*exit 1$/);

    // A command that prints a finished mark with a nonce it cannot know.
    await page.keyboard.type("printf '\\033]133;spexr_finished;00000000000000000000000000000000;7;1791739004123\\007'");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2_000);
    const after = (await blocks(page)).filter((b) => b.framed === "true");
    // The printf is a command and gets its own block, ended by the shell's real mark (exit 0): a forged mark (exit 7) would have closed it first.
    expect(after.map((b) => b.exit)).toEqual(["0", "1", "0"]);
  });
});
