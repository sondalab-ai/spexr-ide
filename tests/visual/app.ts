import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import type { PreparedRun, Theme } from "./prepare";

export const REPO_ROOT = path.resolve(__dirname, "../..");
const DESKTOP_DIR = path.join(REPO_ROOT, "apps", "desktop");
/** The packaged entry point, not src-gen directly: it is the path users start through. */
const ENTRY = path.join(DESKTOP_DIR, "scripts", "spexr-electron-main.js");
const FIXTURE_PLUGINS = path.join(__dirname, "fixtures", "plugins");

/** The demo's frame. The window's content area is set to exactly this. */
export const CONTENT = { width: 1440, height: 900 } as const;

export interface LaunchOptions {
  readonly run: PreparedRun;
  /** Add `--use-angle=swiftshader --enable-unsafe-swiftshader`, for a host with no GL. */
  readonly swiftshader: boolean;
  /** The backend's stdout and stderr are appended here, for the plugin deployer's lines. */
  readonly logFile: string;
}

export interface Launched {
  readonly app: ElectronApplication;
  readonly page: Page;
}

/**
 * Start spexr on the prepared run, isolated from the machine it runs on.
 *
 * Separate from tests/e2e/fixtures/app.ts on purpose: this launcher redirects
 * the Electron profile, Theia's config dir and HOME, puts the `claude` stub
 * first on PATH and loads the fixture extension, none of which the e2e suite
 * wants.
 */
export async function launch({ run, swiftshader, logFile }: LaunchOptions): Promise<Launched> {
  // Second layer behind playwright.config.ts: nothing starts spexr off a runner.
  if (process.env.GITHUB_ACTIONS !== "true") {
    throw new Error("tests/visual launches spexr and runs only on a GitHub Actions runner.");
  }
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.CLAUDE_CONFIG_DIR;
  Object.assign(env, {
    HOME: run.home,
    XDG_CONFIG_HOME: path.join(run.home, ".config"),
    PATH: `${run.bin}${path.delimiter}${process.env.PATH ?? ""}`,
    THEIA_CONFIG_DIR: run.configDir,
    // The entry point sets this too, to the same directory; set here so the
    // launcher states it rather than relying on that.
    THEIA_DEFAULT_PLUGINS: `local-dir:${path.join(REPO_ROOT, "plugins")}`,
    THEIA_PLUGINS: `local-dir:${FIXTURE_PLUGINS}`,
    SPEXR_VISUAL_ACK: run.ackDir,
    SPEXR_MODEL_DOWNLOAD: "off",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    TZ: "UTC",
    LANG: "en_US.UTF-8",
    // macOS's /bin/bash otherwise opens every terminal with a notice about zsh.
    BASH_SILENCE_DEPRECATION_WARNING: "1",
  });

  // The workspace comes right after the entry point and every flag after it:
  // yargs reads a bare flag followed by a path as that flag's value, which
  // silently started the app with no workspace.
  const args = [
    ENTRY,
    run.workspace,
    `--electronUserData=${run.userData}`,
    "--force-device-scale-factor=1",
    ...(swiftshader ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []),
  ];
  const app = await electron.launch({ cwd: DESKTOP_DIR, args, env, timeout: 120_000 });

  const log = fs.createWriteStream(logFile, { flags: "a" });
  log.write(`# launch ${new Date().toISOString()} swiftshader=${swiftshader}\n`);
  app.process().stdout?.on("data", (chunk: Buffer) => log.write(chunk));
  app.process().stderr?.on("data", (chunk: Buffer) => log.write(chunk));
  // `close`, not `exit`: stdio can still deliver data after the process exits.
  app.process().on("close", () => log.end());

  const page = await app.firstWindow({ timeout: 120_000 });
  return { app, page };
}

/**
 * Size the window's content area to the demo's 1440×900, and give it focus so
 * focus styles render: without system focus Chromium draws no `:focus` state.
 */
export async function sizeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error("no window");
    if (win.isMaximized()) win.unmaximize();
    if (win.isFullScreen()) win.setFullScreen(false);
    win.setContentSize(size.width, size.height);
    win.setPosition(0, 0);
    win.focus();
  }, CONTENT);
}

/** Whether this renderer can make a WebGL2 context: xterm's renderer depends on it. */
export async function hasWebgl2(page: Page): Promise<boolean> {
  await page.waitForLoadState("domcontentloaded");
  return page.evaluate(() => {
    try {
      return !!document.createElement("canvas").getContext("webgl2");
    } catch {
      return false;
    }
  });
}

export interface Readiness {
  /** Milliseconds from the call until each condition held. */
  readonly shellMs: number;
  readonly layoutMs: number;
  readonly fontsMs: number | null;
  /** `document.fonts.check('13px "Geist Mono"')` when the wait ended. */
  readonly geistMonoCheck: boolean;
  /** Geist Mono faces the app declared, with their load status, read before anything forces a load. */
  readonly geistMonoFaces: string[];
}

/**
 * Wait for the shell, spexr's layout-ready marker, and Geist Mono — each on
 * its own condition, never a fixed sleep. The font wait is bounded: a face
 * nothing has requested stays unloaded, and that is a finding, not a hang.
 */
export async function waitForReady(page: Page): Promise<Readiness> {
  const t0 = Date.now();
  await page.waitForSelector(".theia-ApplicationShell", { timeout: 120_000 });
  await page.waitForSelector("#theia-statusBar", { timeout: 120_000 });
  const shellMs = Date.now() - t0;
  await page.waitForSelector("body[data-spexr-layout-ready]", { timeout: 120_000 });
  const layoutMs = Date.now() - t0;

  let fontsMs: number | null = null;
  try {
    await page.waitForFunction(() => document.fonts.check('13px "Geist Mono"'), undefined, { timeout: 30_000 });
    fontsMs = Date.now() - t0;
  } catch {
    fontsMs = null;
  }
  const fonts = await page.evaluate(() => ({
    check: document.fonts.check('13px "Geist Mono"'),
    faces: [...document.fonts]
      .filter((f) => f.family.replace(/["']/g, "") === "Geist Mono")
      .map((f) => `${f.weight} ${f.style}: ${f.status}`),
  }));
  return { shellMs, layoutMs, fontsMs, geistMonoCheck: fonts.check, geistMonoFaces: fonts.faces };
}

export interface ThemeState {
  readonly expected: Theme;
  /** `html[data-sl-theme]`, which spexr's tokens resolve against. */
  readonly slTheme: string | null;
  /** Theia's own theme, from the body class it sets (`theia-dark`, `theia-light`). */
  readonly theiaBodyClass: string | null;
  readonly confirmed: boolean;
}

export async function readTheme(page: Page, expected: Theme): Promise<ThemeState> {
  const { slTheme, theiaBodyClass } = await page.evaluate(() => ({
    slTheme: document.documentElement.getAttribute("data-sl-theme"),
    theiaBodyClass: [...document.body.classList].find((c) => /^theia-(dark|light|hc)/.test(c)) ?? null,
  }));
  return {
    expected,
    slTheme,
    theiaBodyClass,
    confirmed: slTheme === expected && theiaBodyClass === `theia-${expected}`,
  };
}

/**
 * Close the app, and kill it if closing takes longer than `ms`: a save prompt
 * or a stuck backend must not hold the job until its timeout.
 */
export async function closeApp(app: ElectronApplication, ms = 20_000): Promise<"closed" | "killed"> {
  const proc = app.process();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"killed">((resolve) => {
    timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve("killed");
    }, ms);
  });
  const closed = app.close().then(() => "closed" as const, () => "killed" as const);
  const result = await Promise.race([closed, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

/* ── S6a: can the window reach 1440×900? ─────────────────────────────────── */

/** What was asked of the window, what it became, and the display it is on. */
export interface WindowSizeOutcome {
  readonly requested: { readonly width: number; readonly height: number };
  /** `getContentSize()` after `setContentSize`, which {@link sizeWindow} has already called. */
  readonly afterSetContentSize: string;
  /** After a second try with `setBounds` (the content plus the frame's difference), at y 0. */
  readonly afterSetBounds: string;
  readonly display: { readonly bounds: string; readonly workArea: string; readonly scaleFactor: number };
  readonly innerSize: string;
  /** True when the page itself is 1440×900. */
  readonly reached: boolean;
}

/**
 * Record whether the OS let the window reach the demo's 1440×900. On macOS the
 * window is held inside the display's work area, so a runner whose display is
 * shorter keeps a shorter page whatever `setContentSize` asks (the earlier
 * captures were 1440×677). Called once, after {@link sizeWindow}; the second
 * lever is `setBounds`, and nothing here changes how the window is created.
 */
export async function probeWindowSize(app: ElectronApplication, page: Page): Promise<WindowSizeOutcome> {
  const raw = await app.evaluate(({ BrowserWindow, screen }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error("no window");
    const read = (): string => win.getContentSize().join("x");
    const afterSetContentSize = read();
    const frame = win.getSize()[1]! - win.getContentSize()[1]!;
    win.setBounds({ x: 0, y: 0, width: size.width, height: size.height + frame });
    const afterSetBounds = read();
    const d = screen.getPrimaryDisplay();
    const rect = (r: { x: number; y: number; width: number; height: number }): string => `${r.x},${r.y} ${r.width}x${r.height}`;
    return { afterSetContentSize, afterSetBounds, display: { bounds: rect(d.bounds), workArea: rect(d.workArea), scaleFactor: d.scaleFactor } };
  }, CONTENT);
  await page.waitForTimeout(500);
  const innerSize = await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`);
  return { requested: CONTENT, ...raw, innerSize, reached: innerSize === `${CONTENT.width}x${CONTENT.height}` };
}
