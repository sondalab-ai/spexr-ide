import { test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { CONTENT, closeApp, hasWebgl2, launch, readTheme, sizeWindow, waitForReady, type Launched } from "./app";
import { nativeCapture } from "./native";
import { prepareRun, type Os, type Theme } from "./prepare";
import { probeLog, probeMain, probePage } from "./probes";
import { QUICK_OPEN, captureStable, parkPointer, runCommand, waitForAck, type SceneResult } from "./scenes";

const OS: Os = process.platform === "darwin" ? "mac" : "linux";
const THEMES = (process.env.VISUAL_THEMES ?? "dark,light")
  .split(",")
  .map((t) => t.trim())
  .filter((t): t is Theme => t === "dark" || t === "light");
/** Artifacts: one folder per OS and theme, uploaded as `screenshots-<os>-<theme>`. */
const OUT_ROOT = process.env.VISUAL_OUT ?? path.join(__dirname, "out");
/**
 * Profiles, HOME and the fixture workspace. Outside the checkout, and not
 * under /tmp: spexr closes any workspace whose path contains `/tmp/`.
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
    const meta: Record<string, unknown> = { os: OS, theme, content: CONTENT, scenes: [] as SceneResult[] };
    const writeMeta = (): void => fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify(meta, null, 2));

    let launched: Launched | undefined;
    try {
      // First launch: probe WebGL2 on the first window, before the long layout
      // wait. Without it, relaunch on SwiftShader from a fresh profile.
      const attempts: Array<{ swiftshader: boolean; webgl2: boolean }> = [];
      for (const swiftshader of [false, true]) {
        const run = prepareRun(path.join(RUN_ROOT, `${theme}-${attempts.length}`), theme, OS);
        const logFile = path.join(out, `backend${swiftshader ? "-swiftshader" : ""}.log`);
        launched = await launch({ run, swiftshader, logFile });
        const webgl2 = await hasWebgl2(launched.page);
        attempts.push({ swiftshader, webgl2 });
        meta.webglAttempts = attempts;
        meta.backendLog = path.basename(logFile);
        meta.run = { workspace: run.workspace, ackDir: run.ackDir };
        if (webgl2 || swiftshader) break;
        await closeApp(launched.app);
        launched = undefined;
      }
      if (!launched) throw new Error("no launch");
      const { app, page } = launched;
      const ackDir = (meta.run as { ackDir: string }).ackDir;

      await sizeWindow(app);
      meta.readiness = await waitForReady(page);
      // The window can be resized by the restored state while the shell starts.
      await sizeWindow(app);

      meta.theme = await readTheme(page, theme);
      if (!(meta.theme as { confirmed: boolean }).confirmed) {
        // The settings route did not land: fall back to the key spexr reads
        // first. The reload goes through the restored-layout path, a different
        // state from a first launch, so the summary says which route it took.
        await page.evaluate((t) => localStorage.setItem("spexr.theme", t), theme);
        await page.reload();
        meta.readinessAfterReload = await waitForReady(page);
        meta.themeRoute = "localStorage spexr.theme + reload";
        meta.theme = await readTheme(page, theme);
      } else {
        meta.themeRoute = "settings.json workbench.colorTheme";
      }
      writeMeta();

      await runCommand(page, "Parity: Probe environment");
      meta.extensions = await waitForAck(ackDir, "probe");

      const scenes = meta.scenes as SceneResult[];
      const shoot = async (scene: SceneResult["scene"], ack?: unknown): Promise<void> => {
        await parkPointer(page);
        const file = path.join(out, `${scene}.png`);
        const shot = await captureStable(page, file);
        scenes.push({ scene, file: path.basename(file), ...shot, ack });
        writeMeta();
      };

      // The demo shows the bottom panel; spexr can start with it collapsed.
      meta.bottomPanelOpened = await page.evaluate(() => {
        const panel = document.getElementById("theia-bottom-content-panel");
        return !panel || panel.classList.contains("lm-mod-hidden") || panel.getBoundingClientRect().height < 10;
      });
      if (meta.bottomPanelOpened) await runCommand(page, "View: Toggle Bottom Panel");

      // base: resolve.ts in front, cursor 41:18, line 45 selected, line 36 at the top.
      await runCommand(page, "Parity: Base scene");
      const baseAck = await waitForAck(ackDir, "base");
      await page.locator(".monaco-editor .cursors-layer .cursor").first().waitFor({ state: "attached", timeout: 15_000 });
      await shoot("base", baseAck);
      meta.page = await probePage(page);
      meta.main = await probeMain(app);
      if (OS === "mac") meta.native = await nativeCapture(app, path.join(out, "native-base"));
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
      const toastAck = await waitForAck(ackDir, "toast");
      await page.locator(".theia-notification-list-item", { hasText: "Probe saved" }).first().waitFor({ state: "visible", timeout: 15_000 });
      await shoot("toast", toastAck);

      // focus-tree: the Explorer focused, resolve.ts its selected row.
      await runCommand(page, "Parity: Focus tree scene");
      const treeAck = await waitForAck(ackDir, "focusTree");
      await page.waitForFunction(() => !!document.activeElement?.closest("#files, .theia-Files, .theia-FileTree"), undefined, { timeout: 15_000 }).catch(() => undefined);
      meta.treeFocused = await page.evaluate(() => !!document.activeElement?.closest("#files, .theia-Files, .theia-FileTree"));
      await shoot("focus-tree", treeAck);
    } catch (err) {
      meta.error = String(err instanceof Error ? err.stack : err);
      if (launched) {
        await launched.page.screenshot({ path: path.join(out, "failure.png") }).catch(() => undefined);
      }
      throw err;
    } finally {
      if (launched) meta.close = await closeApp(launched.app);
      const logFile = path.join(out, (meta.backendLog as string | undefined) ?? "backend.log");
      meta.log = probeLog(logFile);
      writeMeta();
    }
  });
}
