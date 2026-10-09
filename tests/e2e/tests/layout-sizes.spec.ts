/**
 * TC-LAYOUT-SIZES: the default layout's island sizes (Lumen parity S5c, S6b)
 *
 * The unit tests drive the sizing with a fake shell; this checks Theia's real
 * layout. A workspace opened for the first time has no stored layout, so
 * spexr sizes the islands before any panel shows: the left island is seeded
 * for the agent terminal (432px), the right 352px, the bottom 204px. The page
 * fixture waits for the layout's settled mark, which comes after the sizes.
 *
 * The left island follows the view in front (S6b, D2): 432px with the agent
 * terminal, 264px with the Explorer, and the width a user gives a view is
 * remembered for that view. This suite runs without the agent CLI, so the
 * agent terminal never starts and the Explorer is the view in front: the
 * seeded 432px is taken to the Explorer's 264px once the layout has settled.
 * The agent terminal's 432px is not measured here. It is measured by the
 * visual capture, whose stub CLI starts it (tests/visual/capture.visual.ts,
 * the "agent-front" scene and `checkLeftViews`), and the width policy itself
 * is tested by left-island-width.test.ts.
 *
 * The right island is read with a project tab in front: the Darkfactory
 * dashboard, which a launch can leave in front, collapses the right panel
 * by design (darkfactory-sidebar-policy.ts), and a project tab brings it back
 * at its size.
 */
import { test, expect, activateTab } from "../fixtures/app.js";
import type { Page } from "@playwright/test";

type Area = "left" | "right" | "bottom";

/** An island's rect, in CSS px; null when it is not laid out. */
async function island(page: Page, area: Area): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return page.evaluate((area) => {
    const r = document.querySelector<HTMLElement>(`.spexr-island[data-island="${area}"]`)?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }, area);
}

/**
 * Run a command through the command palette, as a user would. Focus goes
 * back to the page first: a key pressed while an iframe holds the focus never
 * reaches Theia's keybindings.
 */
async function runCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press("Escape");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  const input = page.locator(".quick-input-widget input.input");
  await page.keyboard.press("F1");
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(`>${label}`);
  await page.locator(".quick-input-list .monaco-list-row.focused", { hasText: label }).waitFor({ state: "visible", timeout: 15_000 });
  await page.keyboard.press("Enter");
  await page.locator(".quick-input-widget").waitFor({ state: "hidden", timeout: 15_000 });
}

/** The right island's width with a project tab (Welcome) in front of the main area. */
async function rightIslandWidth(page: Page): Promise<number | undefined> {
  await activateTab(page, "Welcome");
  return (await island(page, "right"))?.w;
}

/** Drag the split handle between the left island and the main area by `dx` px. */
async function dragLeftSash(page: Page, dx: number): Promise<void> {
  const at = await page.evaluate(() => {
    const split = document.getElementById("theia-left-right-split-panel");
    const left = document.querySelector<HTMLElement>('.spexr-island[data-island="left"]')?.getBoundingClientRect();
    const handle = split
      ? [...split.children]
          .filter((c): c is HTMLElement => c.classList.contains("lm-SplitPanel-handle"))
          .map((c) => c.getBoundingClientRect())
          .find((r) => r.width > 0 && left !== undefined && Math.abs(r.left - left.right) <= 1)
      : undefined;
    return handle ? { x: handle.left + handle.width / 2, y: handle.top + handle.height / 2 } : null;
  });
  if (!at) throw new Error("no split handle beside the left island");
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx, at.y, { steps: 8 });
  await page.mouse.up();
}

/**
 * Bring a view to the front of the left island through its activity tile
 * (`#shell-tab-<widget id>`). A tile already in front is left alone: clicking
 * it would collapse the island.
 */
async function showLeftView(page: Page, widgetId: string): Promise<void> {
  const tab = page.locator(`#shell-tab-${widgetId}`);
  await tab.waitFor({ state: "visible", timeout: 15_000 });
  // A tab that a synthetic pointer event (activateTab) just touched can swallow
  // the first click, so the click is tried again while the tile is not current.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await tab.evaluate((el) => el.classList.contains("lm-mod-current"))) break;
    await tab.click();
    await page.waitForTimeout(500);
  }
  await expect(tab).toHaveClass(/lm-mod-current/, { timeout: 10_000 });
}

const SEARCH = "search-view-container";
const EXPLORER = "explorer-view-container";

test.describe("the default layout's island sizes", () => {
  test("a workspace's first open sizes the islands: left 264 (the Explorer in front), right 352, bottom 204", async ({ page }) => {
    await expect.poll(async () => (await island(page, "left"))?.w, { timeout: 15_000 }).toBeCloseTo(264, 0);
    await expect.poll(() => rightIslandWidth(page), { timeout: 15_000 }).toBeCloseTo(352, 0);
    // The bottom panel can start hidden; it opens at the size it was given.
    if ((await island(page, "bottom")) === null) await runCommand(page, "View: Toggle Bottom Panel");
    await expect.poll(async () => (await island(page, "bottom"))?.h, { timeout: 15_000 }).toBeCloseTo(204, 0);
  });

  test("switching the left view leaves the right and bottom islands where they are", async ({ page }) => {
    await showLeftView(page, EXPLORER);
    await expect.poll(async () => (await island(page, "left"))?.w, { timeout: 15_000 }).toBeCloseTo(264, 0);
    await expect.poll(() => rightIslandWidth(page), { timeout: 15_000 }).toBeCloseTo(352, 0);
    const bottom = (await island(page, "bottom"))?.h;
    for (const view of [SEARCH, EXPLORER, SEARCH]) {
      await showLeftView(page, view);
      await expect.poll(async () => (await island(page, "left"))?.w, { timeout: 10_000 }).toBeCloseTo(264, 0);
    }
    expect(await rightIslandWidth(page)).toBeCloseTo(352, 0);
    // The bottom panel can start hidden; only a panel that was showing is compared.
    if (bottom !== undefined) expect((await island(page, "bottom"))?.h).toBeCloseTo(bottom, 0);
  });

  test("the left island's width is each view's own: a drag on the Explorer stays with it", async ({ page }) => {
    await showLeftView(page, EXPLORER);
    await expect.poll(async () => (await island(page, "left"))?.w, { timeout: 15_000 }).toBeCloseTo(264, 0);
    await dragLeftSash(page, 60);
    await expect.poll(async () => (await island(page, "left"))?.w, { timeout: 10_000 }).toBeCloseTo(324, 0);
    await showLeftView(page, SEARCH);
    await expect.poll(async () => (await island(page, "left"))?.w, { timeout: 10_000 }).toBeCloseTo(264, 0);
    await showLeftView(page, EXPLORER);
    await expect.poll(async () => (await island(page, "left"))?.w, { timeout: 10_000 }).toBeCloseTo(324, 0);
  });

  test("a restored layout keeps its own widths", async ({ page }) => {
    test.setTimeout(150_000);
    await expect.poll(async () => (await island(page, "left"))?.w, { timeout: 15_000 }).toBeCloseTo(264, 0);
    await dragLeftSash(page, 100);
    await expect.poll(async () => (await island(page, "left"))?.w, { timeout: 10_000 }).toBeCloseTo(364, 0);

    // Theia stores the layout on unload and restores it on load.
    await page.reload();
    await page.waitForSelector("body[data-spexr-layout-ready]", { timeout: 60_000 });
    await expect.poll(async () => (await island(page, "left"))?.w, { timeout: 15_000 }).toBeCloseTo(364, 0);
    await expect.poll(() => rightIslandWidth(page), { timeout: 15_000 }).toBeCloseTo(352, 0);
  });
});
