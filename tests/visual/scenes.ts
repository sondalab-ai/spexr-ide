import type { Page } from "@playwright/test";
import fs from "fs";
import path from "path";

export const SCENES = ["base", "palette", "toast", "focus-tree"] as const;
export type Scene = (typeof SCENES)[number];

export interface SceneResult {
  readonly scene: Scene;
  readonly file: string;
  /** Screenshots taken until two in a row were identical. */
  readonly attempts: number;
  /** False when the picture never settled; the last capture is kept anyway. */
  readonly stable: boolean;
  /** What the fixture extension reported, when the scene goes through it. */
  readonly ack?: unknown;
}

/**
 * Run a command through the command palette, the way a user would.
 *
 * Focus is first handed back to the page body: a key pressed while focus sits
 * in an iframe (a webview) never reaches Theia's keybindings. F1 opens the
 * palette with the `>` prefix, and the other binding is tried if it does not.
 * The run waits until the focused row is the command before pressing Enter,
 * so a slow filter cannot run a different one.
 */
export async function runCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press("Escape");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  const input = page.locator(".quick-input-widget input.input");
  let opened = false;
  for (const key of ["F1", process.platform === "darwin" ? "Meta+Shift+P" : "Control+Shift+P"]) {
    await page.keyboard.press(key);
    opened = await input
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) break;
  }
  if (!opened) throw new Error(`the command palette did not open (focus: ${await describeFocus(page)})`);
  await input.fill(`>${label}`);
  await page
    .locator(".quick-input-list .monaco-list-row.focused", { hasText: label })
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.keyboard.press("Enter");
  await page.locator(".quick-input-widget").waitFor({ state: "hidden", timeout: 15_000 });
}

/** The focused element as `tag#id.class`, for error messages. */
export async function describeFocus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return "none";
    const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls}; document.hasFocus=${document.hasFocus()}`;
  });
}

/** Wait for the fixture extension's acknowledgement file, and return what it wrote. */
export async function waitForAck(ackDir: string, name: string, timeoutMs = 120_000): Promise<unknown> {
  const file = path.join(ackDir, `${name}.json`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as { ok?: boolean; error?: string };
      fs.renameSync(file, `${file}.${Date.now()}.seen`);
      if (data.ok === false) throw new Error(`fixture extension: ${name} failed: ${data.error}`);
      return data;
    }
    if (Date.now() > deadline) throw new Error(`fixture extension: no "${name}" acknowledgement in ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * Park the pointer where nothing reacts to hover: the bottom-right corner of
 * the bottom panel, which is terminal ground. A pointer left on code would
 * raise Monaco's hover after a delay.
 */
export async function parkPointer(page: Page): Promise<void> {
  const box = await page.evaluate(() => {
    const el = document.getElementById("theia-bottom-content-panel");
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 ? { x: r.right - 24, y: r.bottom - 12 } : { x: window.innerWidth - 4, y: window.innerHeight - 40 };
  });
  await page.mouse.move(box.x, box.y);
}

/**
 * Wait until no finite animation or transition is running. Infinite ones (a
 * live dot) are ignored: they never end, and the stability check below
 * decides whether they move pixels.
 */
async function waitForFiniteAnimations(page: Page, timeoutMs = 5_000): Promise<void> {
  await page
    .waitForFunction(
      () =>
        document.getAnimations().every((a) => {
          const end = a.effect?.getComputedTiming().endTime;
          return a.playState !== "running" || end === Infinity;
        }),
      undefined,
      { timeout: timeoutMs },
    )
    .catch(() => undefined);
}

/**
 * Screenshot the window once two consecutive captures are byte-identical.
 * Async work (semantic colours, decorations, a toast sliding in) lands in its
 * own time, and this waits for the pixels rather than guessing a delay. Gives
 * up after `maxAttempts`, keeping the last capture and saying so.
 */
export async function captureStable(page: Page, file: string, maxAttempts = 12): Promise<{ attempts: number; stable: boolean }> {
  await waitForFiniteAnimations(page);
  let previous = await page.screenshot({ animations: "allow" });
  for (let attempt = 2; attempt <= maxAttempts; attempt++) {
    await page.waitForTimeout(400);
    const next = await page.screenshot({ animations: "allow" });
    if (next.equals(previous)) {
      fs.writeFileSync(file, next);
      return { attempts: attempt, stable: true };
    }
    previous = next;
  }
  fs.writeFileSync(file, previous);
  return { attempts: maxAttempts, stable: false };
}

/** `Meta+P` on macOS, `Control+P` elsewhere: Theia's Quick Open. */
export const QUICK_OPEN = process.platform === "darwin" ? "Meta+P" : "Control+P";
