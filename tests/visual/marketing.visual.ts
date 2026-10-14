import { test, type Page } from "@playwright/test";
import fs from "fs";
import http from "http";
import path from "path";
import { CONTENT, closeApp, launch, sizeWindow, waitForReady } from "./app";
import { captureCrop, captureStable, parkPointer, runCommand } from "./scenes";
import { startLiveStubs } from "./stubs";
import { prepareShowcase, showcaseLiveDirs, touchShowcase } from "./showcase";

/**
 * The marketing capture: dark-theme, 2x screenshots of the showcase fixture
 * for sondalab.ai/spexr. Not a test of spexr: nothing is compared. A scene
 * whose content never shows up is still captured, with a `note` in meta.json,
 * so one slow model does not cost the other pictures. Run by
 * .github/workflows/marketing-shots.yml only.
 */

const OUT = path.join(__dirname, "out", "marketing");
const DPR = Number(process.env.VISUAL_DPR ?? "2");
/** Fetched by the workflow (`fetch-model`); set explicitly so the webpack bundle cannot resolve another package dir. */
const MODELS_DIR = path.resolve(__dirname, "../../packages/theia-extensions/resources/models");
const RUN_ROOT = path.join(process.env.RUNNER_TEMP ?? path.join(__dirname, ".run"), "spexr-marketing");
/** The card browser follows the newest localhost link in the session, http://localhost:4317/report. */
const WWW_PORT = 4317;
/** The local models run on the runner's CPU. */
const SLOW = 15 * 60_000;

/** Selectors, from the widgets' own markup. */
const SEL = {
  specList: ".spexr-spec-list__item", // tests/e2e/fixtures/app.ts sel.specItem
  planItem: ".spexr-plan-checklist__item", // spec-workflow-stepper.tsx
  wall: ".spexr-darkfactory", // darkfactory-wall-widget.tsx:295
  card: ".spexr-df-card", // agent-tile.tsx:486
  cardSummaryLoading: ".spexr-df-card__ai.is-loading", // agent-tile.tsx:546
  cardOverview: ".spexr-df-card__overview", // agent-tile.tsx:557
  group: ".spexr-df-group", // darkfactory-wall-widget.tsx:1360
  groupName: ".spexr-df-group__name", // agent-tile.tsx:337
  needsYou: '.spexr-df-group__attn[data-kind="attn"]', // agent-tile.tsx:346
  dfSearch: ".spexr-df-search__input", // darkfactory-wall-widget.tsx:1487
  dfSearchCount: ".spexr-df-search__count", // darkfactory-wall-widget.tsx:1519
  pinned: ".spexr-df-pinned", // agent-tile.tsx:810
  browserSwitch: ".spexr-df-pinned .spexr-df-switch", // agent-tile.tsx:726
  webview: ".spexr-df-browser__view", // card-browser-pane.tsx:58
  experts: ".spexr-experts-widget", // experts-widget.tsx:69
  expertActive: '.spexr-experts-widget [aria-current="true"]', // experts-widget.tsx:268
  memory: ".spexr-memory-widget", // memory-widget.tsx:80
  memoryItem: ".spexr-memory-list__item", // memory-widget.tsx:286
  search: ".spexr-smart-search", // smart-search-widget.tsx:90
  searchBusy: ".spexr-smart-search__progress, .spexr-smart-search__status", // smart-search-widget.tsx:261,381
  searchInput: ".spexr-smart-search__input", // smart-search-widget.tsx:375
  searchDesc: ".spexr-smart-search__desc-text", // smart-search-widget.tsx:323
  commitBox: ".spexr-scm-input textarea", // spexr-scm-commit-widget.tsx:31
  generate: ".spexr-scm-input__generate", // spexr-scm-commit-widget.tsx:33
} as const;

interface Shot {
  readonly scene: string;
  readonly file: string;
  readonly stable: boolean;
  readonly waitedMs: number;
  readonly note?: string;
}

/** Open a view through its palette toggle, unless it is already showing (the toggle would close it). */
async function reveal(page: Page, label: string, selector: string): Promise<void> {
  if (await page.locator(selector).first().isVisible().catch(() => false)) return;
  await runCommand(page, label);
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 30_000 });
}

type Side = "left" | "right" | "bottom";
const TOGGLE: Record<Side, string> = {
  left: "View: Toggle Left Panel",
  right: "View: Toggle Right Panel",
  bottom: "View: Toggle Bottom Panel",
};

/**
 * Show or hide the side and bottom panels, so each scene gives its view the
 * room it needs. Theia only has toggles, so each panel's state is read first.
 */
async function layout(page: Page, want: Record<Side, boolean>): Promise<void> {
  for (const side of ["left", "right", "bottom"] as const) {
    // spexr's shell wraps each area in an island (shell/islands.ts; tests/e2e/tests/islands.spec.ts).
    const open = await page.evaluate((area) => {
      const r = document.querySelector(`.spexr-island[data-island="${area}"]`)?.getBoundingClientRect();
      return !!r && r.width > 40 && r.height > 40;
    }, side);
    if (open !== want[side]) await runCommand(page, TOGGLE[side]);
  }
  await page.waitForTimeout(600);
}

/** Resolve once `count` elements match, or throw after `timeout`. */
async function atLeast(page: Page, selector: string, count: number, timeout: number): Promise<void> {
  await page.waitForFunction(({ s, n }) => document.querySelectorAll(s).length >= n, { s: selector, n: count }, { timeout, polling: 500 });
}

test("marketing dark", async () => {
  test.setTimeout(60 * 60_000);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const meta: { dpr: number; shots: Shot[]; modelsMissing?: boolean; window?: string } = { dpr: DPR, shots: [] };
  const save = (): void => fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 2));

  const run = prepareShowcase(RUN_ROOT);
  const www = http
    .createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(run.www, "report.html")));
    })
    .listen(WWW_PORT);
  const stubs = startLiveStubs(run, showcaseLiveDirs(run));
  const { app, page } = await launch({
    run,
    swiftshader: false,
    logFile: path.join(OUT, "backend.log"),
    dpr: DPR,
    env: { SPEXR_MODELS_DIR: MODELS_DIR },
  });
  try {
    await sizeWindow(app);
    await waitForReady(page);
    await sizeWindow(app);
    // At 2x the window needs a screen of 2880x1800 device px; a smaller one clips it.
    meta.window = await page.evaluate(() => `${innerWidth}x${innerHeight}@${devicePixelRatio}`);
    save();
    if (meta.window !== `${CONTENT.width}x${CONTENT.height}@${DPR}`) {
      throw new Error(`the window is ${meta.window}, not ${CONTENT.width}x${CONTENT.height}@${DPR}: the screen is too small`);
    }

    /** Wait for `ready`, then capture the window. A timeout is recorded, not thrown. */
    const shoot = async (scene: string, ready: () => Promise<unknown>, timeout = 60_000): Promise<Shot> => {
      const t0 = Date.now();
      let note: string | undefined;
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        ready(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`not ready after ${timeout} ms`)), timeout);
        }),
      ]).catch((err: unknown) => {
        note = String(err instanceof Error ? err.message : err);
      });
      if (timer) clearTimeout(timer);
      // Focusing a field can scroll the whole document by a few px; the shell never scrolls on its own.
      await page.evaluate(() => {
        for (const el of [document.scrollingElement, document.body, document.getElementById("theia-app-shell")]) if (el) el.scrollTop = 0;
      });
      await parkPointer(page);
      const file = path.join(OUT, `${scene}.png`);
      const r = await captureStable(page, file);
      const shot: Shot = { scene, file: path.basename(file), stable: r.stable, waitedMs: Date.now() - t0, ...(note ? { note } : {}) };
      meta.shots.push(shot);
      save();
      return shot;
    };

    // The hero: spexr's Welcome page, bare and with the side panels.
    await shoot("mk-welcome", async () => {
      await reveal(page, "View: Toggle Welcome", ".spexr-welcome-widget");
      await layout(page, { left: false, right: false, bottom: false });
    });
    await shoot("mk-welcome-ide", async () => {
      await layout(page, { left: true, right: true, bottom: false });
    });

    // Smart search first: indexing and the file descriptions run while the other scenes are set up.
    await shoot(
      "mk-search",
      async () => {
        await reveal(page, "View: Toggle Search", SEL.search);
        await layout(page, { left: true, right: false, bottom: false });
        // The plain-text Search part shares the container; collapse it so smart search gets the height.
        // Theia's view-container part (`.part`) holding the text search widget (#search-in-workspace); its header toggles it.
        const textSearch = page.locator(".theia-view-container .part", { has: page.locator("#search-in-workspace") }).first();
        if (!(await textSearch.locator(".theia-mod-collapsed").count())) await textSearch.locator(".theia-view-container-part-header").first().click();
        await page.waitForTimeout(600);
        await page.waitForFunction((s) => !document.querySelector(s), SEL.searchBusy, { timeout: SLOW, polling: 1000 });
        await page.locator(SEL.searchInput).fill("where do bank dates get parsed");
        await page.keyboard.press("Enter");
        await atLeast(page, SEL.searchDesc, 3, SLOW);
      },
      SLOW,
    );

    await shoot("mk-specs", async () => {
      await reveal(page, "View: Toggle Active Spec", ".spexr-spec-panel");
      await layout(page, { left: false, right: false, bottom: false });
      await atLeast(page, SEL.specList, 6, 30_000);
    });

    await shoot("mk-spec-detail", async () => {
      // The list shows a spec's plan under its stepper; opening the spec would put an editor and a preview in front.
      const row = page.locator(SEL.specList, { hasText: "Reconcile within a date window" }).first();
      await row.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await atLeast(page, SEL.planItem, 5, 30_000);
    });

    touchShowcase(run);
    const wall = await shoot(
      "mk-darkfactory",
      async () => {
        await reveal(page, "View: Toggle Darkfactory", SEL.wall);
        await layout(page, { left: false, right: false, bottom: false });
        // The plant schedule takes a third of the wall; the wall shot gives the cards the room (schedule-sidebar.tsx:313).
        const closeSchedule = page.locator('[aria-label="Close the schedule"]').first();
        if (await closeSchedule.isVisible().catch(() => false)) await closeSchedule.click();
        await atLeast(page, SEL.card, 5, 60_000);
        await page.locator(SEL.needsYou).first().waitFor({ state: "visible", timeout: 60_000 });
        await page.locator(SEL.cardOverview).first().waitFor({ state: "visible", timeout: SLOW });
        await page.waitForFunction((s) => !document.querySelector(s), SEL.cardSummaryLoading, { timeout: SLOW, polling: 1000 });
      },
      SLOW,
    );
    // No overview line on any card means the generation model never answered.
    if (wall.note) meta.modelsMissing = true;
    save();

    // ledgerline's group holds the Claude sessions and the opencode one.
    {
      const t0 = Date.now();
      const group = page.locator(SEL.group, { has: page.locator(SEL.groupName, { hasText: "ledgerline" }) }).first();
      const box = await group.boundingBox();
      const file = path.join(OUT, "mk-harness.png");
      if (box) {
        await parkPointer(page);
        await captureCrop(page, file, [{ x: box.x, y: box.y, w: box.width, h: Math.min(box.height, CONTENT.height - box.y) }]);
      }
      meta.shots.push({ scene: "mk-harness", file: path.basename(file), stable: !!box, waitedMs: Date.now() - t0, ...(box ? {} : { note: "no ledgerline group" }) });
      save();
    }

    await shoot(
      "mk-df-search",
      async () => {
        // The schedule comes back for this shot (darkfactory-wall-widget.tsx:1656).
        const openSchedule = page.locator('[aria-label="Open the plant schedule"]').first();
        if (await openSchedule.isVisible().catch(() => false)) await openSchedule.click();
        await page.locator(SEL.dfSearch).fill("the one about month-end dates");
        await page.keyboard.press("Enter");
        await page.waitForFunction((s) => /^[1-9]\d* found$/.test(document.querySelector(s)?.textContent?.trim() ?? ""), SEL.dfSearchCount, { timeout: SLOW, polling: 500 });
      },
      SLOW,
    );
    await page.locator(SEL.dfSearch).fill("");
    await page.keyboard.press("Escape");

    await shoot(
      "mk-df-card",
      async () => {
        await page.locator(SEL.card, { hasText: "Reconcile window" }).first().click();
        await page.locator(SEL.pinned).first().waitFor({ state: "visible", timeout: 60_000 });
        await page.locator(SEL.browserSwitch).first().click();
        await page.waitForFunction(
          (s) => {
            const wv = document.querySelector(s) as (HTMLElement & { getURL?: () => string; isLoading?: () => boolean }) | null;
            return !!wv && (wv.getAttribute("src") ?? "").includes("localhost:4317") && wv.isLoading?.() === false;
          },
          SEL.webview,
          { timeout: 120_000, polling: 500 },
        );
      },
      150_000,
    );

    await shoot("mk-experts", async () => {
      await reveal(page, "View: Toggle Experts", SEL.experts);
      await layout(page, { left: false, right: true, bottom: false });
      await page.locator(SEL.expertActive).first().waitFor({ state: "visible", timeout: 30_000 });
    });

    await shoot("mk-memory", async () => {
      await reveal(page, "View: Toggle Memory", SEL.memory);
      await layout(page, { left: false, right: true, bottom: false });
      await atLeast(page, SEL.memoryItem, 5, 30_000);
    });

    await shoot(
      "mk-git",
      async () => {
        await reveal(page, "View: Toggle Source Control", ".spexr-scm-input");
        await layout(page, { left: true, right: false, bottom: false });
        await page.locator(SEL.generate).click();
        await page.waitForFunction((s) => ((document.querySelector(s) as HTMLTextAreaElement | null)?.value ?? "").trim().length > 0, SEL.commitBox, { timeout: SLOW, polling: 1000 });
      },
      SLOW,
    );
  } finally {
    await closeApp(app);
    stubs.stop();
    www.close();
    save();
  }
});
