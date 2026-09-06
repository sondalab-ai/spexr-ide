import { test as base, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DESKTOP_DIR = path.join(REPO_ROOT, "apps/desktop");
// apps/desktop/package.json "main": "src-gen/backend/electron-main.js"
const ELECTRON_MAIN = path.join(DESKTOP_DIR, "src-gen/backend/electron-main.js");
// Workspaces live under test-results/workspaces/ (gitignored) rather than
// os.tmpdir() so that the SpexrBootstrapContribution temp-dir check does not
// close them on startup — the check only targets /tmp and /var/folders paths.
const WORKSPACE_BASE = path.join(REPO_ROOT, "test-results", "workspaces");
// Do NOT set executablePath: when executablePath is omitted, Playwright uses
// require("electron/index.js") and injects -r loader.js which splices
// --remote-debugging-port=0 out of process.argv.  With executablePath set,
// loader.js is NOT injected, so the Chromium flag stays in argv and Theia's
// argv.slice(2) picks up ELECTRON_MAIN as the workspace path.

export interface AppFixtures {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly workspace: string;
}

/**
 * Creates an isolated temp workspace per test, launches the Electron app
 * pointing at it, and tears everything down after.
 */
export const test = base.extend<AppFixtures>({
  workspace: async ({}, use) => {
    fs.mkdirSync(WORKSPACE_BASE, { recursive: true });
    const dir = fs.mkdtempSync(path.join(WORKSPACE_BASE, "spexr-e2e-"));
    // Minimal workspace structure the app expects
    fs.mkdirSync(path.join(dir, "docs/specs"), { recursive: true });
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  },

  app: async ({ workspace }, use) => {
    const app = await electron.launch({
      cwd: DESKTOP_DIR,
      args: [ELECTRON_MAIN, workspace],
      env: {
        ...process.env,
        THEIA_DEFAULT_PLUGINS: "local-dir:plugins",
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        DISPLAY: process.env.DISPLAY ?? ":99",
      },
    });
    await use(app);
    await app.close();
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    await page.waitForSelector(".theia-ApplicationShell", { timeout: 30_000 });
    // Status bar appears after Theia finishes JS init (keybindings, plugins).
    await page.waitForSelector("#theia-statusBar", { timeout: 30_000 });
    // Dismiss workspace-trust dialog (Theia asks for trust on unknown/temp dirs).
    const trustDialog = page.locator("#theia-dialog-shell.workspace-trust-dialog");
    if (await trustDialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await page.locator('button:has-text("Yes, I trust the authors")').click();
      await trustDialog.waitFor({ state: "hidden", timeout: 5_000 });
    }
    // SpexrShellLayoutContribution reveals widgets into the tab bars over
    // several stages; activating a view before it is done gets undone by a
    // later stage. The contribution marks the body when it finishes.
    await page.waitForSelector("body[data-spexr-layout-ready]", { timeout: 30_000 });
    // Let Theia panel-layout animations finish before tests start interacting.
    await page.waitForTimeout(1000);
    await use(page);
  },
});

export { expect } from "@playwright/test";

// ── Selectors ──────────────────────────────────────────────────────────────

export const sel = {
  // Spec panel
  specPanel: ".spexr-spec-panel",
  createBtn: "button:has-text('Create new spec')",
  refreshBtn: "button:has-text('Refresh')",
  specList: ".spexr-spec-list",
  specItem: ".spexr-spec-list__item",
  specTitle: ".spexr-spec-list__title",

  // Workflow stepper
  stepper: ".spexr-stepper",
  stepItem: (state: "current" | "done" | "pending") =>
    `.spexr-stepper__item--${state}`,
  stepBtn: (label: string) =>
    `.spexr-stepper__btn:has(.spexr-stepper__label:text("${label}"))`,

  // Plan checklist
  planChecklist: ".spexr-plan-checklist",
  planHeader: ".spexr-plan-checklist__header",
  planItem: ".spexr-plan-checklist__item",
  planCheckbox: (id: string) =>
    `.spexr-plan-checklist__item:has(.spexr-plan-checklist__ac-ref:text("${id}")) input[type="checkbox"]`,

  // Spec lint (bottom panel)
  lintWidget: ".spexr-spec-lint-widget",
  lintOk: ".spexr-spec-lint__ok",       // rendered when report.total === 0
  lintSummary: ".spexr-spec-lint__summary", // rendered when report.total > 0
  lintFinding: ".spexr-spec-lint__finding",

  // Spec preview
  previewWidget: ".spexr-spec-preview",
  previewBody: ".spexr-spec-preview__body",
  previewEmpty: ".spexr-spec-preview__empty",

  // Theia helpers
  tab: (label: string) => `.p-TabBar-tab:has-text("${label}")`,
  notification: ".theia-notification-message",
} as const;

/**
 * Activate a shell tab once, by hand.
 *
 * Lumino's TabBar._evtPointerDown hit-tests with clientX/clientY, and synthetic
 * PointerEvents default to 0/0, so the test embeds the tab's real bounding rect
 * in the event. Playwright's own click is not used here: it can miss the hit
 * test or land on a neighbouring widget while the layout is still settling.
 */
async function activateTab(page: Page, label: string): Promise<void> {
  await page.evaluate((wanted) => {
    const labels = [
      ...document.querySelectorAll<HTMLElement>(".lm-TabBar-tabLabel, .p-TabBar-tabLabel"),
    ];
    const specLabel = labels.find((el) => el.textContent?.trim() === wanted);
    if (!specLabel) throw new Error(`Tab "${wanted}" not found in DOM`);
    const tab = specLabel.closest<HTMLElement>("li") ?? specLabel.parentElement;
    if (!tab) throw new Error(`Tab "${wanted}" <li> not found`);
    const rect = tab.getBoundingClientRect();
    tab.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
        pointerId: 1,
        isPrimary: true,
      }),
    );
  }, label);
}

/** Labels of the tabs currently in front, for diagnostics when activation fails. */
async function frontTabLabels(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".lm-mod-current, .p-mod-current")]
      .map((tab) => tab.textContent?.trim())
      .filter((label): label is string => !!label)
      .join(", "),
  );
}

/**
 * Open the SPEXR spec view by activating its tab in the main area.
 * The spec view is pre-opened at startup with activate:false so the tab always
 * exists in the main tab bar — no keyboard shortcut needed.
 * Theia (lumino) uses .lm-TabBar-tabLabel; .p-TabBar-tabLabel is the legacy alias.
 *
 * The page fixture already waits for the layout to settle, so activation
 * normally succeeds on the first attempt; the retry stays as a safety net for
 * tests that switch tabs themselves and for anything that re-reveals a widget
 * later in a test.
 */
export async function openSpecView(page: Page): Promise<void> {
  // Widget sets this.title.label = "Spec" (not widgetName "Active Spec").
  // The tab only exists once openSideViews() has run, which takes a couple of
  // seconds, so wait for it rather than assuming it is already there.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll<HTMLElement>(".lm-TabBar-tabLabel, .p-TabBar-tabLabel")].some(
        (el) => el.textContent?.trim() === "Spec",
      ),
    { timeout: 15_000 },
  );

  await openPanelTab(page, "Spec", sel.specPanel);
}

/**
 * Bring the "Spec validation" panel to the front of the bottom dock.
 *
 * Opening a spec reveals both companion panels, and the product deliberately
 * leaves Linked resources in front (see spec-companion-panels-contribution.ts),
 * so the lint widget is attached but hidden until its tab is selected.
 */
export async function openLintPanel(page: Page): Promise<void> {
  await openPanelTab(page, "Spec validation", sel.lintWidget);
}

/**
 * Activate a tab until the widget it fronts is actually visible.
 *
 * Activation is retried rather than done once: a test that switches tabs, or a
 * panel revealed later by the app, can put another widget back in front.
 */
async function openPanelTab(page: Page, label: string, selector: string): Promise<void> {
  const panel = page.locator(selector);
  const deadline = Date.now() + 20_000;
  for (;;) {
    await activateTab(page, label);
    try {
      await panel.waitFor({ state: "visible", timeout: 1_000 });
      return;
    } catch (err) {
      if (Date.now() >= deadline) {
        throw new Error(
          `"${label}" stayed hidden after repeated tab activation; tabs in front: ${await frontTabLabels(page)}`,
          { cause: err },
        );
      }
    }
  }
}

/**
 * Open a spec file in the editor via the Spec panel "Open" button.
 * SPEXR's default layout does not include the file Explorer sidebar, so
 * tree-based navigation is not available.  We instead surface the spec
 * through the panel, which is always present.
 * The file must already exist on disk before calling this.
 */
export async function openFileInEditor(page: Page, _filename: string): Promise<void> {
  await openSpecView(page);
  await waitForSpecList(page);
  // Click the "Open" button of the first spec item to open it in the editor.
  const openBtn = page
    .locator(sel.specItem)
    .first()
    .locator('button[aria-label^="Open"]');
  await openBtn.click();
  // Settle for editor to open and emit onCurrentEditorChanged.
  await page.waitForTimeout(1_000);
}

/** Wait until at least one spec item appears in the list. */
export async function waitForSpecList(page: Page): Promise<void> {
  // If the spec panel tab was deactivated (e.g. after openSpec opened an editor),
  // re-activate it before waiting for list items.
  const panel = page.locator(sel.specPanel);
  if (!(await panel.isVisible().catch(() => false))) {
    await openSpecView(page);
    // Brief settle after tab switch before checking list contents.
    await page.waitForTimeout(500);
  }
  // Files seeded directly to disk bypass fileService.onDidRunOperation, so the
  // spec widget never receives a refresh event.  Click Refresh if items are not
  // visible within 2 s to trigger refreshSpecs() manually.
  // Scope the click to the spec panel to avoid hitting the Memory panel's own
  // "Refresh" button which appears earlier in DOM order.
  const item = page.locator(sel.specItem);
  if (!(await item.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await page.locator(`${sel.specPanel} ${sel.refreshBtn}`).click();
  }
  await page.waitForSelector(sel.specItem, { timeout: 10_000 });
}

/**
 * Click "Create new spec", fill the two Quick Input prompts (slug + title),
 * and wait for the spec list to populate.
 * The Quick Input widget is Monaco's `.quick-input-widget`.
 */
export async function createSpecViaUI(
  page: Page,
  slug = "e2e-test",
  title = "E2E Test",
): Promise<void> {
  await page.click(sel.createBtn);
  const qi = page.locator(".quick-input-widget input");
  // First prompt: slug
  await qi.waitFor({ timeout: 8_000 });
  await qi.fill(slug);
  await page.keyboard.press("Enter");
  // Second prompt: title
  await qi.waitFor({ timeout: 5_000 });
  await qi.fill(title);
  await page.keyboard.press("Enter");
  // createSpec() fires openSpec(fileUri) asynchronously after the Quick Input
  // resolves. openSpec activates the editor tab, hiding the Spec panel.
  // Wait for the editor to finish opening (tab label changes from "Welcome" to
  // the spec filename) before re-activating the Spec panel.
  await page.waitForTimeout(2000);
  await openSpecView(page);
}
