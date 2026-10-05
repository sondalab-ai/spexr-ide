import { test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { CONTENT, closeApp, hasWebgl2, launch, readTheme, sizeWindow, waitForReady, type Launched } from "./app";
import { OUT_ROOT, provenance, type CaptureMeta } from "./meta";
import { nativeCapture } from "./native";
import { prepareRun, type Os, type Theme } from "./prepare";
import { probeFullScreen, probeLights, probeLog, probeMain, probePage, probeZoom } from "./probes";
import {
  QUICK_OPEN,
  captureStable,
  firstVisibleLine,
  parkPointer,
  placeBottomPanel,
  runCommand,
  waitForAck,
  type Scene,
  type SceneAck,
} from "./scenes";

const OS: Os = process.platform === "darwin" ? "mac" : "linux";
const THEMES = (process.env.VISUAL_THEMES ?? "dark,light")
  .split(",")
  .map((t) => t.trim())
  .filter((t): t is Theme => t === "dark" || t === "light");
/** The demo's bottom panel starts at y 666 (reference/demo-regions.json, region "panel"). */
const DEMO_PANEL_TOP = 666;
/**
 * Profiles, HOME and the fixture workspace: under the runner's temp
 * directory, which is outside the checkout and not under /tmp (spexr closes
 * any workspace whose path contains `/tmp/`). The `.run` fallback inside the
 * checkout is only for a runner without RUNNER_TEMP.
 */
const RUN_ROOT = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, "spexr-visual")
  : path.join(__dirname, ".run");

for (const theme of THEMES) {
  test(`${OS} ${theme}`, async () => {
    test.setTimeout(15 * 60_000);
    const out = path.join(OUT_ROOT, `${OS}-${theme}`);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const meta: CaptureMeta = { os: OS, theme, content: CONTENT, provenance: provenance(), scenes: [] };
    const writeMeta = (): void => fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify(meta, null, 2));

    let launched: Launched | undefined;
    try {
      // First launch: probe WebGL2 on the first window, before the long layout
      // wait. Without it, relaunch on SwiftShader from a fresh profile.
      const attempts: Array<{ swiftshader: boolean; webgl2: boolean }> = [];
      for (const swiftshader of [false, true]) {
        const run = prepareRun(path.join(RUN_ROOT, `${theme}-${attempts.length}`), theme);
        const logFile = path.join(out, `backend${swiftshader ? "-swiftshader" : ""}.log`);
        launched = await launch({ run, swiftshader, logFile });
        const webgl2 = await hasWebgl2(launched.page);
        attempts.push({ swiftshader, webgl2 });
        meta.webglAttempts = attempts;
        meta.backendLog = path.basename(logFile);
        meta.run = { workspace: run.workspace, ackDir: run.ackDir, configDir: run.configDir };
        if (webgl2 || swiftshader) break;
        await closeApp(launched.app);
        launched = undefined;
      }
      if (!launched || !meta.run) throw new Error("no launch");
      const { app, page } = launched;
      const ackDir = meta.run.ackDir;

      await sizeWindow(app);
      meta.readiness = await waitForReady(page);
      // The window can be resized by the restored state while the shell starts.
      await sizeWindow(app);

      // Set through workbench.colorTheme in the seeded settings; confirmed on
      // both html[data-sl-theme] and Theia's body class, and reported if not.
      meta.themeCheck = await readTheme(page, theme);
      writeMeta();

      await runCommand(page, "Parity: Probe environment");
      meta.extensions = (await waitForAck(ackDir, "probe")) as CaptureMeta["extensions"];

      const shoot = async (scene: Scene, ack?: SceneAck): Promise<void> => {
        await parkPointer(page);
        const file = path.join(out, `${scene}.png`);
        const shot = await captureStable(page, file);
        meta.scenes.push({ scene, file: path.basename(file), ...shot, ack });
        writeMeta();
      };

      // The demo shows the bottom panel; spexr can start with it collapsed.
      meta.bottomPanelOpened = await page.evaluate(() => {
        const panel = document.getElementById("theia-bottom-content-panel");
        return !panel || panel.classList.contains("lm-mod-hidden") || panel.getBoundingClientRect().height < 10;
      });
      if (meta.bottomPanelOpened) await runCommand(page, "View: Toggle Bottom Panel");
      meta.bottomPanel = await placeBottomPanel(page, DEMO_PANEL_TOP);

      // base: resolve.ts in front, cursor 41:18, line 45 selected, line 36 at the top.
      await runCommand(page, "Parity: Base scene");
      const baseAck = (await waitForAck(ackDir, "base")) as SceneAck;
      await page.locator(".monaco-editor .cursors-layer .cursor").first().waitFor({ state: "attached", timeout: 15_000 });
      await shoot("base", baseAck);
      meta.baseFirstVisibleLine = await firstVisibleLine(page);
      meta.page = await probePage(page);
      meta.main = await probeMain(app);
      if (OS === "mac") {
        meta.native = await nativeCapture(app, path.join(out, "native-base"));
        const shot = meta.native.find((s) => s.ok && s.mode === "window -l") ?? meta.native.find((s) => s.ok);
        const width = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds().width ?? 0);
        if (shot) meta.lights = await probeLights(path.join(out, shot.file), page, width);
      }
      writeMeta();

      // palette: Quick Open with "probe" typed.
      await page.keyboard.press("Escape");
      await page.keyboard.press(QUICK_OPEN);
      const input = page.locator(".quick-input-widget input.input");
      await input.waitFor({ state: "visible", timeout: 15_000 });
      await page.keyboard.type("probe");
      await page
        .locator(".quick-input-list .monaco-list-row", { hasText: "probe" })
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });
      await shoot("palette");
      await page.keyboard.press("Escape");
      await input.waitFor({ state: "hidden", timeout: 15_000 });

      // toast: an info message with an Undo action.
      await runCommand(page, "Parity: Toast scene");
      const toastAck = (await waitForAck(ackDir, "toast")) as SceneAck;
      await page.locator(".theia-notification-list-item", { hasText: "Probe saved" }).first().waitFor({ state: "visible", timeout: 15_000 });
      await shoot("toast", toastAck);

      // focus-tree: the Explorer focused, resolve.ts its selected row.
      await runCommand(page, "Parity: Focus tree scene");
      const treeAck = (await waitForAck(ackDir, "focusTree")) as SceneAck;
      await page.waitForFunction(() => !!document.activeElement?.closest("#files, .theia-Files, .theia-FileTree"), undefined, { timeout: 15_000 }).catch(() => undefined);
      meta.treeFocused = await page.evaluate(() => !!document.activeElement?.closest("#files, .theia-Files, .theia-FileTree"));
      await shoot("focus-tree", treeAck);

      // macOS: the lights one zoom level out, then the bar's room through full
      // screen. Full screen last, because it moves the window to a Space of
      // its own and back.
      if (OS === "mac") {
        meta.zoom = await probeZoom(app, page, path.join(out, "native-zoom-out"), meta.lights);
        writeMeta();
        meta.fullScreen = await probeFullScreen(app, page, path.join(out, "fullscreen.png"));
        writeMeta();
      }

      // The one assertion of the capture (S5b-2's review): on macOS the
      // system's traffic lights sit in the bar's room and on its centre, at
      // 100% and one zoom level out. Everything else is for looking at.
      if (OS === "mac") {
        const problems = [
          ...(meta.lights ? meta.lights.problems : ["no native capture to find the lights in"]),
          ...(meta.zoom?.problems ?? []).map((p) => `zoom ${meta.zoom?.level}: ${p}`),
        ];
        if (problems.length) throw new Error(`macOS traffic lights: ${problems.join("; ")}`);
      }
    } catch (err) {
      meta.error = String(err instanceof Error ? err.stack : err);
      if (launched) {
        await launched.page.screenshot({ path: path.join(out, "failure.png") }).catch(() => undefined);
      }
      throw err;
    } finally {
      if (launched) meta.close = await closeApp(launched.app);
      meta.log = probeLog(path.join(out, meta.backendLog ?? "backend.log"), meta.run?.configDir ?? "");
      writeMeta();
    }
  });
}
