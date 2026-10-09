import { test } from "@playwright/test";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { CONTENT, closeApp, hasWebgl2, launch, probeWindowSize, readTheme, sizeWindow, waitForReady, type Launched } from "./app";
import { OUT_ROOT, provenance, type CaptureMeta } from "./meta";
import { nativeCapture } from "./native";
import { agentSession, liveAgentDirs, prepareRun, touchTranscripts, type Os, type PreparedRun, type Theme } from "./prepare";
import { checkAgentPane, checkEdge, checkFixture, checkLitRim, checkPalette, checkToast, edgePoints, probeAgentPane, probeFixtureState, probeLitRim, samplePixels } from "./checks";
import { probeProcesses, startLiveStubs, type LiveStubs } from "./stubs";
import { AGENT_PANE_REGIONS, EDITOR_REGIONS, PALETTE_REGIONS, RIGHT_PANEL_REGIONS, TOAST_REGIONS, probeEditor, probeEditorPadding, probeFullScreen, probeLights, probeLog, probeMain, probePage, probeRegions, probeZoom } from "./probes";
import {
  captureStable,
  bottomPanelTop,
  firstVisibleLine,
  openCommandPalette,
  parkPointer,
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
/** The workspace's TODO.md in the right-panel scene: three open items and a done one. */
const RIGHT_PANEL_TODO = [
  "# TODO",
  "",
  "- [ ] Await the cache write in resolve.ts",
  "- [ ] Re-run the probe suite",
  "- [ ] Fix the R finding in components.css",
  "- [x] Keep the p95 under 2 ms",
  "",
].join("\n");

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
    // S6a: the live agents' stand-in processes, one set per launch attempt.
    const stubs: LiveStubs[] = [];
    let prepared: PreparedRun | undefined;
    try {
      // First launch: probe WebGL2 on the first window, before the long layout
      // wait. Without it, relaunch on SwiftShader from a fresh profile.
      const attempts: Array<{ swiftshader: boolean; webgl2: boolean }> = [];
      for (const swiftshader of [false, true]) {
        const run = prepareRun(path.join(RUN_ROOT, `${theme}-${attempts.length}`), theme);
        const logFile = path.join(out, `backend${swiftshader ? "-swiftshader" : ""}.log`);
        launched = await launch({ run, swiftshader, logFile });
        prepared = run;
        stubs.push(startLiveStubs(run, liveAgentDirs(run)));
        const webgl2 = await hasWebgl2(launched.page);
        attempts.push({ swiftshader, webgl2 });
        meta.webglAttempts = attempts;
        meta.backendLog = path.basename(logFile);
        meta.run = { workspace: run.workspace, ackDir: run.ackDir, configDir: run.configDir };
        if (webgl2 || swiftshader) break;
        await closeApp(launched.app);
        for (const set of stubs.splice(0)) set.stop();
        launched = undefined;
      }
      if (!launched || !meta.run || !prepared) throw new Error("no launch");
      const { app, page } = launched;
      const ackDir = meta.run.ackDir;

      await sizeWindow(app);
      meta.readiness = await waitForReady(page);
      // The window can be resized by the restored state while the shell starts.
      await sizeWindow(app);
      // S6a: record whether the OS let the window reach 1440×900 (macOS may hold it to the work area).
      meta.windowSize = await probeWindowSize(app, page);
      writeMeta();

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

      // A scene that is not what it is meant to show fails the run (S5f). The
      // problems are collected as the scenes go and thrown after the last
      // capture, so one bad number does not hide every picture after it; a
      // scene that cannot be set up at all throws where it stands.
      const check = (scene: string, problems: readonly string[]): void => {
        if (problems.length === 0) return;
        (meta.sceneProblems ??= {})[scene] = [...problems];
        writeMeta();
      };

      // The demo shows the bottom panel; spexr can start with it collapsed.
      meta.bottomPanelOpened = await page.evaluate(() => {
        const panel = document.getElementById("theia-bottom-content-panel");
        return !panel || panel.classList.contains("lm-mod-hidden") || panel.getBoundingClientRect().height < 10;
      });
      if (meta.bottomPanelOpened) await runCommand(page, "View: Toggle Bottom Panel");
      // Never dragged (S5c): the capture shows spexr's own default sizes as a
      // new user gets them, decided before any panel shows and settled before
      // the layout mark the capture waits on.
      meta.bottomPanel = await bottomPanelTop(page);

      // S6a: the shell terminal runs the demo's two commands, one after the
      // other: the pnpm stub records each one's exit code, which is how the
      // run knows what a WebGL terminal drew.
      const pnpm: Record<string, number | undefined> = {};
      await runCommand(page, "Parity: Shell: first command");
      await waitForAck(ackDir, "shell");
      pnpm["test-probe"] = ((await waitForAck(ackDir, "pnpm-test-probe", 60_000)) as { exit?: number }).exit;
      await runCommand(page, "Parity: Shell: second command");
      await waitForAck(ackDir, "shell2");
      pnpm["sl-audit"] = ((await waitForAck(ackDir, "pnpm-sl-audit", 60_000)) as { exit?: number }).exit;

      // S6h: the agent terminal's Claude stub writes the "Refactor the audit"
      // transcript under the --session-id the product gave it, which the agent
      // pane follows. The terminal starts before the layout is ready, so this
      // is normally already there.
      const agentWait = Date.now();
      while (!agentSession(prepared) && Date.now() - agentWait < 90_000) await page.waitForTimeout(500);
      const agent = agentSession(prepared);
      if (!agent) throw new Error("fixture: the agent terminal's claude stub never wrote its session (agent-session.json): the terminal did not start it with --session-id");

      // base: resolve.ts in front, cursor 41:18, line 45 selected, line 36 at the top.
      touchTranscripts(prepared);
      await runCommand(page, "Parity: Base scene");
      const baseAck = (await waitForAck(ackDir, "base")) as SceneAck;
      await page.locator(".monaco-editor .cursors-layer .cursor").first().waitFor({ state: "attached", timeout: 15_000 });
      // S6a: the title pill reads the backend's scan, which lands in its own
      // time and counts a live agent only while its transcript is under ten
      // minutes old; the transcripts are touched again until it reads 2.
      const waited = Date.now();
      let fixtureState = await probeFixtureState(page);
      while (fixtureState.agentsPill !== "2 agents running" && Date.now() - waited < 120_000) {
        touchTranscripts(prepared);
        await page.waitForTimeout(2_000);
        fixtureState = await probeFixtureState(page);
      }
      if (fixtureState.agentsPill !== "2 agents running") {
        const ps = probeProcesses((cmd, args) => execFileSync(cmd, args, { encoding: "utf8", timeout: 10_000 }), stubs[stubs.length - 1]!.pids);
        throw new Error(
          `fixture: the title pill still reads ${JSON.stringify(fixtureState.agentsPill)} after ${Math.round((Date.now() - waited) / 1000)} s, want "2 agents running"; ` +
            `ps comm=claude: ${JSON.stringify(ps.psClaude)}, stub cwds: ${JSON.stringify(ps.cwd)}`,
        );
      }
      await shoot("base", baseAck);
      fixtureState = await probeFixtureState(page);
      const execText = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: "utf8", timeout: 10_000 });
      const stubSet = stubs[stubs.length - 1]!;
      meta.fixture = {
        state: fixtureState,
        waitedMs: Date.now() - waited,
        report: {
          base: (baseAck as { fixture?: { problems?: number; dirty?: string[] } }).fixture,
          pnpm,
          processes: { pids: stubSet.pids, dirs: stubSet.dirs, ...probeProcesses(execText, stubSet.pids) },
        },
      };
      writeMeta();
      check("fixture", checkFixture(fixtureState, meta.fixture.report!));

      // S6h: the agent pane in front of the right island, folded as the base
      // scene has it, then the tool card expanded (the agent-pane scene). The
      // pane follows the session its terminal started, so it is waited for.
      await page.locator("#theia-right-content-panel .spexr-agent-tool").first().waitFor({ state: "visible", timeout: 60_000 });
      await page.locator('#theia-right-content-panel .spexr-agent-tool[data-state="run"]').first().waitFor({ state: "visible", timeout: 30_000 });
      meta.agentPane = { sessionId: agent.sessionId };
      meta.agentPane.base = { state: await probeAgentPane(page), regions: await probeRegions(page, AGENT_PANE_REGIONS) };
      check("agent pane", checkAgentPane(meta.agentPane.base.state, meta.agentPane.base.regions, false));
      writeMeta();
      const fold = page.locator("#theia-right-content-panel .spexr-agent-tools__fold");
      // Dispatched, not clicked: a real click would focus the right island and light it, and the base scene's lit island is the editor's.
      await fold.dispatchEvent("click");
      await page.locator("#theia-right-content-panel .spexr-agent-tool").nth(10).waitFor({ state: "visible", timeout: 15_000 });
      await shoot("agent-pane");
      meta.agentPane.expanded = { state: await probeAgentPane(page), regions: await probeRegions(page, AGENT_PANE_REGIONS) };
      check("agent pane (expanded)", checkAgentPane(meta.agentPane.expanded.state, meta.agentPane.expanded.regions, true));
      writeMeta();
      await fold.dispatchEvent("click");
      await page.locator("#theia-right-content-panel .spexr-agent-tool").nth(4).waitFor({ state: "detached", timeout: 15_000 });
      meta.baseFirstVisibleLine = await firstVisibleLine(page);
      meta.page = await probePage(page);
      meta.editor = await probeEditor(page);
      meta.main = await probeMain(app);
      if (OS === "mac") {
        meta.native = await nativeCapture(app, path.join(out, "native-base"));
        const shot = meta.native.find((s) => s.ok && s.mode === "window -l") ?? meta.native.find((s) => s.ok);
        const width = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds().width ?? 0);
        if (shot) meta.lights = await probeLights(path.join(out, shot.file), page, width);
      }
      writeMeta();

      // The lit island's light (S5f), in the base scene, where the main island
      // is the lit one: exactly one island lit, wearing the wash, the tint and
      // the drop.
      // The editor island, measured here: with the palette open it is under
      // the palette's centre, where probeRegions' hit test would drop it.
      meta.editorIsland = (await probeRegions(page, EDITOR_REGIONS))["main"];
      meta.litRim = await probeLitRim(page);
      check("lit rim", checkLitRim(meta.litRim));
      writeMeta();

      // palette: the command palette open on a query that finds several
      // commands, some with a shortcut, the first one selected. Placed against
      // the editor island, which is measured with it (S5f).
      const paletteInput = await openCommandPalette(page);
      await paletteInput.fill(">toggle");
      await page.locator(".quick-input-list .monaco-list-row.focused").first().waitFor({ state: "visible", timeout: 30_000 });
      await page.locator(".quick-input-list .monaco-keybinding-key").first().waitFor({ state: "visible", timeout: 30_000 });
      await shoot("palette");
      meta.paletteParity = await probeRegions(page, PALETTE_REGIONS);
      writeMeta();
      const paletteBox = meta.paletteParity["palette"]?.[0];
      if (paletteBox) check("palette edge", checkEdge("palette", await samplePixels(page, path.join(out, "palette.png"), edgePoints(paletteBox))));
      check("palette", checkPalette(meta.paletteParity, meta.editorIsland, await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))));
      await page.keyboard.press("Escape");
      await paletteInput.waitFor({ state: "hidden", timeout: 15_000 });

      // toast: an info message with an Undo action.
      await runCommand(page, "Parity: Toast scene");
      const toastAck = (await waitForAck(ackDir, "toast")) as SceneAck;
      await page.locator(".theia-notification-list-item", { hasText: "Probe saved" }).first().waitFor({ state: "visible", timeout: 15_000 });
      await shoot("toast", toastAck);
      meta.toastParity = await probeRegions(page, TOAST_REGIONS);
      writeMeta();
      check("toast", checkToast(meta.toastParity, meta.editorIsland, await page.evaluate(() => window.innerHeight)));
      const toastBox = meta.toastParity["toast"]?.[0];
      if (toastBox) check("toast edge", checkEdge("toast", await samplePixels(page, path.join(out, "toast.png"), edgePoints(toastBox))));

      // focus-tree: the Explorer focused, resolve.ts its selected row.
      await runCommand(page, "Parity: Focus tree scene");
      const treeAck = (await waitForAck(ackDir, "focusTree")) as SceneAck;
      await page.waitForFunction(() => !!document.activeElement?.closest("#files, .theia-Files, .theia-FileTree"), undefined, { timeout: 15_000 }).catch(() => undefined);
      meta.treeFocused = await page.evaluate(() => !!document.activeElement?.closest("#files, .theia-Files, .theia-FileTree"));
      await shoot("focus-tree", treeAck);

      // After every scene: reading the editor's padding clicks into it and goes
      // to line 1, so no capture follows it.
      meta.editor = { ...(meta.editor ?? (await probeEditor(page))), paddingTop: (await probeEditorPadding(page))?.paddingTop ?? null };
      writeMeta();

      // The right island with each of its three views in front (S5e). The
      // files each view reads are written here, not kept in the fixture, so
      // the Explorer's tree in the earlier scenes stays the demo's. A view's
      // toggle closes it when it is already in front, so it is run again if
      // the first run left it hidden. Any failure fails the capture.
      const ws = meta.run.workspace;
      const seed = (rel: string, text: string): void => {
        fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
        fs.writeFileSync(path.join(ws, rel), text);
      };
      const showRightView = async (toggle: string, root: string, ready: string, refresh = false): Promise<void> => {
        const view = page.locator(`#theia-right-content-panel ${root}`);
        await runCommand(page, toggle);
        if (!(await view.isVisible().catch(() => false))) await runCommand(page, toggle);
        await view.waitFor({ state: "visible", timeout: 15_000 });
        // Experts and Memory read their folders on a Theia file operation, not
        // on a write from outside, so the view is told to read what was seeded.
        if (refresh) await view.getByRole("button", { name: "Refresh" }).click();
        await page.locator(`#theia-right-content-panel ${ready}`).first().waitFor({ state: "visible", timeout: 30_000 });
      };
      meta.rightPanel = {};

      seed("TODO.md", RIGHT_PANEL_TODO);
      await showRightView("View: Toggle TODO", ".spexr-todo", ".spexr-todo__item");
      await shoot("right-panel");
      meta.rightPanel["todo"] = await probeRegions(page, RIGHT_PANEL_REGIONS);
      writeMeta();

      // Two installed experts, the first active (a folder setting, which the
      // view follows), so the first and last rows of the card, the current
      // row's seam and its tile are all on screen.
      for (const [id, name, icon] of [["backend-architect", "backend-architect", "codicon-server"], ["reviewer", "reviewer", "codicon-eye"]] as const) {
        seed(`docs/agents/${id}.md`, `---\nid: ${id}\nname: ${name}\nicon: ${icon}\n---\n\nYou are a ${name}.\n`);
      }
      // The active expert is read without a folder while no agent runs, so
      // the user's settings carry it (the folder's own file too).
      seed(".theia/settings.json", JSON.stringify({ "spexr.experts.activeId": "backend-architect" }, null, 2));
      const userSettings = path.join(meta.run.configDir, "settings.json");
      fs.writeFileSync(
        userSettings,
        JSON.stringify({ ...JSON.parse(fs.readFileSync(userSettings, "utf8")), "spexr.experts.activeId": "backend-architect" }, null, 2) + "\n",
      );
      await showRightView("View: Toggle Experts", ".spexr-experts-panel", '.spexr-experts-list__item[aria-current="true"]', true);
      await page.locator("#theia-right-content-panel .spexr-experts-list__item").nth(1).waitFor({ state: "visible", timeout: 15_000 });
      await shoot("right-experts");
      meta.rightPanel["experts"] = await probeRegions(page, RIGHT_PANEL_REGIONS);
      writeMeta();

      for (const [file, name, type] of [["user_role.md", "senior-engineer", "user"], ["feedback_db.md", "no-mocks-for-the-db", "feedback"]] as const) {
        seed(`docs/memory/${file}`, `---\nname: ${name}\ndescription: A note the agent loads on every session.\ntype: ${type}\n---\n\nBody.\n`);
      }
      await showRightView("View: Toggle Memory", ".spexr-memory-panel", ".spexr-memory-list__item", true);
      await shoot("right-memory");
      meta.rightPanel["memory"] = await probeRegions(page, RIGHT_PANEL_REGIONS);
      writeMeta();

      // S6a: save the two unsaved files, or closing the app stops on a prompt.
      try {
        await runCommand(page, "Parity: Save fixture files");
        if (meta.fixture) meta.fixture.cleanup = await waitForAck(ackDir, "cleanup", 30_000);
      } catch (err) {
        if (meta.fixture) meta.fixture.cleanup = String(err);
      }
      writeMeta();

      // macOS: the lights one zoom level out, then the bar's room through full
      // screen. Full screen last, because it moves the window to a Space of
      // its own and back.
      if (OS === "mac") {
        meta.zoom = await probeZoom(app, page, path.join(out, "native-zoom-out"), meta.lights);
        writeMeta();
        meta.fullScreen = await probeFullScreen(app, page, path.join(out, "fullscreen.png"));
        writeMeta();
      }

      // The capture's assertions, thrown once with every problem (S5f): the
      // scenes' checks against the geometry table, and (S5b-2's review) on
      // macOS the system's traffic lights sitting in the bar's room and on
      // its centre, at 100% and one zoom level out. Everything else is for
      // looking at.
      const problems = Object.entries(meta.sceneProblems ?? {}).map(([scene, found]) => `${scene}: ${found.join("; ")}`);
      if (OS === "mac") {
        problems.push(
          ...(meta.lights ? meta.lights.problems : ["no native capture to find the lights in"]).map((p) => `macOS traffic lights: ${p}`),
          ...(meta.zoom?.problems ?? []).map((p) => `macOS traffic lights, zoom ${meta.zoom?.level}: ${p}`),
        );
      }
      if (problems.length) throw new Error(problems.join(" | "));
    } catch (err) {
      meta.error = String(err instanceof Error ? err.stack : err);
      if (launched) {
        await launched.page.screenshot({ path: path.join(out, "failure.png") }).catch(() => undefined);
      }
      throw err;
    } finally {
      if (launched) meta.close = await closeApp(launched.app);
      for (const set of stubs) set.stop();
      meta.log = probeLog(path.join(out, meta.backendLog ?? "backend.log"), meta.run?.configDir ?? "");
      writeMeta();
    }
  });
}
