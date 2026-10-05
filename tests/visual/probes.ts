import type { ElectronApplication, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

/** What the environment gave this capture: read by the step summary, never asserted on. */
export interface PageProbes {
  readonly webgl2: boolean;
  /** `webgl` / `canvas` / `dom`, read from the bottom terminal's xterm. */
  readonly xtermRenderer: string;
  readonly xtermDetail: string;
  readonly devicePixelRatio: number;
  readonly innerSize: string;
  readonly hasFocus: boolean;
  /** Monaco's line font, as computed on the rendered lines. */
  readonly editorFont: string;
  /** Advance of one character in the editor, measured on a rendered line. */
  readonly monacoCharWidth: number | null;
  /** The top panel, spexr's title bar: shown in either frame since S5b-1. */
  readonly topPanelVisible: boolean;
  /** Theia's in-page window controls: present only with a custom (frameless) window. */
  readonly windowControls: boolean;
}

export interface MainProbes {
  readonly electron: string;
  readonly chromium: string;
  readonly node: string;
  readonly platform: string;
  readonly contentSize: string;
  readonly mediaSourceId: string;
}

export interface LogProbes {
  /** From the plugin deployer: "Deploy batch of N accepted plugins". */
  readonly deployedPlugins: number | null;
  /**
   * "The local plugin referenced by … does not exist." lines, except Theia's
   * own per-user plugin folders under the config dir, which a fresh profile
   * never has; those are counted in `userPluginDirsMissing`.
   */
  readonly missingPluginPaths: string[];
  readonly userPluginDirsMissing: number;
}

export async function probePage(page: Page): Promise<PageProbes> {
  return page.evaluate(() => {
    let webgl2 = false;
    try {
      webgl2 = !!document.createElement("canvas").getContext("webgl2");
    } catch {
      webgl2 = false;
    }
    const term = document.querySelector<HTMLElement>("#theia-bottom-content-panel .xterm") ?? document.querySelector<HTMLElement>(".xterm");
    let xtermRenderer = "none";
    let xtermDetail = "no terminal";
    if (term) {
      const canvases = [...term.querySelectorAll("canvas")];
      const rows = term.querySelector(".xterm-rows");
      const classes = canvases.map((c) => c.className || "(no class)");
      const gl = canvases.some((c) => {
        try {
          return !!(c.getContext("webgl2") || c.getContext("webgl"));
        } catch {
          return false;
        }
      });
      xtermRenderer = rows && rows.childElementCount > 0 ? "dom" : canvases.length === 0 ? "none" : gl ? "webgl" : "canvas";
      xtermDetail = `${canvases.length} canvas [${classes.join(", ")}], dom rows ${rows ? rows.childElementCount : 0}`;
    }

    // A visible line with enough text to average over; hidden editors stay in the DOM.
    const line = [...document.querySelectorAll<HTMLElement>(".monaco-editor .view-lines .view-line")].find(
      (el) => (el.textContent ?? "").trim().length > 20 && el.getBoundingClientRect().width > 0,
    );
    let monacoCharWidth: number | null = null;
    let editorFont = "no editor";
    if (line) {
      const cs = getComputedStyle(line);
      editorFont = `${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
      const range = document.createRange();
      range.selectNodeContents(line);
      const text = line.textContent ?? "";
      monacoCharWidth = text.length ? Math.round((range.getBoundingClientRect().width / text.length) * 1000) / 1000 : null;
    }
    const top = document.getElementById("theia-top-panel");
    return {
      webgl2,
      xtermRenderer,
      xtermDetail,
      devicePixelRatio: window.devicePixelRatio,
      innerSize: `${window.innerWidth}x${window.innerHeight}`,
      hasFocus: document.hasFocus(),
      editorFont,
      monacoCharWidth,
      topPanelVisible: !!top && !top.classList.contains("lm-mod-hidden") && top.getBoundingClientRect().height > 0,
      windowControls: !!document.getElementById("window-controls"),
    };
  });
}

export async function probeMain(app: ElectronApplication): Promise<MainProbes> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const [w, h] = win ? win.getContentSize() : [0, 0];
    return {
      electron: process.versions.electron ?? "",
      chromium: process.versions.chrome ?? "",
      node: process.versions.node ?? "",
      platform: `${process.platform}-${process.arch}`,
      contentSize: `${w}x${h}`,
      mediaSourceId: win ? win.getMediaSourceId() : "",
    };
  });
}

export function probeLog(logFile: string, configDir: string): LogProbes {
  const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  const batches = [...text.matchAll(/Deploy batch of (\d+) accepted plugins/g)].map((m) => Number(m[1]));
  const missing = [...new Set([...text.matchAll(/The local plugin referenced by (\S+) does not exist/g)].map((m) => m[1] ?? ""))];
  const userDirs = new Set(["plugins", "deployedPlugins"].map((d) => `local-dir:${path.join(configDir, d)}`));
  return {
    deployedPlugins: batches.length ? batches.reduce((a, b) => a + b, 0) : null,
    missingPluginPaths: missing.filter((m) => !userDirs.has(m)),
    userPluginDirsMissing: missing.filter((m) => userDirs.has(m)).length,
  };
}
