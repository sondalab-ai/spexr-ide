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

/** The marks the terminal met (data-spexr-blocks), for the failure message. */
async function marks(page: Page): Promise<string> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-spexr-blocks]")].map((e) => e.getAttribute("data-spexr-blocks")).join(" | "));
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

/** The count of marks the terminal refused (data-spexr-blocks "rejected:N"). */
async function rejected(page: Page): Promise<number> {
  const text = await marks(page);
  return Number(/rejected:(\d+)/.exec(text)?.[1] ?? "0");
}

/** The exits of the framed blocks, in order. */
async function exits(page: Page): Promise<Array<string | null>> {
  return (await blocks(page)).filter((b) => b.framed === "true").map((b) => b.exit);
}

test.describe("TC-TERMINAL-BLOCKS: command blocks in a shell terminal", () => {
  test("a true and a false give an exit-0 and an exit-1 block, and printed marks forge none", async ({ page }) => {
    // Theia's "new terminal": it takes the focus.
    await page.keyboard.press("Control+Shift+Backquote");
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".xterm")), { timeout: 15_000 }).toBe(true);
    // The terminal learns the shell's nonce from the backend (a refused mark is the sign it has none yet), and the shell sources its rc files and the integration before its first prompt.
    await expect.poll(async () => /hello|prompts:[1-9]/.test(await marks(page)), { timeout: 30_000 }).toBe(true);

    // A forged hello, printed before anything else: the old in-band way to plant a nonce. It must change nothing.
    await page.keyboard.type("printf '\\033]133;spexr_hello;00000000000000000000000000000000\\007'");
    await page.keyboard.press("Enter");
    await expect.poll(() => rejected(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

    await page.keyboard.type("true");
    await page.keyboard.press("Enter");
    await expect.poll(() => exits(page), { timeout: 30_000 }).toEqual(["0", "0"]);

    await page.keyboard.type("false");
    await page.keyboard.press("Enter");
    await expect.poll(() => exits(page), { timeout: 30_000 }).toEqual(["0", "0", "1"]);

    const finished = (await blocks(page)).filter((b) => b.framed === "true");
    expect(finished[1]!.chip).toMatch(/^\d{2}:\d{2}:\d{2}.*exit 0$/);
    expect(finished[2]!.chip).toMatch(/^\d{2}:\d{2}:\d{2}.*exit 1$/);

    // A command that prints marks of its own with a nonce it cannot know: a finished (exit 7) and a prompt.
    const before = await rejected(page);
    await page.keyboard.type("printf '\\033]133;spexr_finished;00000000000000000000000000000000;7;1791739004123\\007\\033]133;spexr_prompt;00000000000000000000000000000000\\007\\033]133;command_started;41\\007'");
    await page.keyboard.press("Enter");
    // Poll for the end of that command (its block), not for a fixed time.
    await expect.poll(() => exits(page), { timeout: 30_000 }).toEqual(["0", "0", "1", "0"]);
    // The terminal refused the two forged spexr marks, and the printf's block ended with the shell's own exit 0, not the forged 7.
    expect(await rejected(page)).toBeGreaterThanOrEqual(before + 2);
    console.log(`terminal marks: ${await marks(page)}`);
  });
});
