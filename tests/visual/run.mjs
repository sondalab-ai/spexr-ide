#!/usr/bin/env node
// @ts-check

/**
 * Entry point of the screenshot capture: `pnpm --filter @spexr/visual capture`.
 *
 * Refuses to run unless `CI` is set. The capture launches the spexr Electron
 * app, and launching it on a workstation has opened enough windows to crash
 * one; it belongs on a GitHub runner (.github/workflows/screenshots.yml).
 *
 * Runs the Playwright capture, then writes a summary of every `out/<os>-<theme>/
 * meta.json` to `$GITHUB_STEP_SUMMARY` (or stdout), whether or not the capture
 * passed. Nothing here compares images or gates anything: the screenshots are
 * for looking at.
 *
 * Env: VISUAL_THEMES (default "dark,light"), VISUAL_OUT (default ./out).
 */

import { spawnSync } from "child_process";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.CI) {
  console.error(
    "tests/visual: refusing to run outside CI. The capture launches the spexr app;\n" +
      "run it through .github/workflows/screenshots.yml (label a PR `screenshots`, or dispatch the workflow).",
  );
  process.exit(1);
}

const OUT = process.env.VISUAL_OUT ?? path.join(HERE, "out");
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const result = spawnSync(process.execPath, [cli, "test", "--config", path.join(HERE, "playwright.config.ts")], {
  cwd: HERE,
  stdio: "inherit",
  env: { ...process.env, VISUAL_OUT: OUT },
});

// Also printed, so the job log carries it for anyone reading the run from the CLI.
const summary = renderSummary(OUT);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.info(summary);

process.exit(result.status ?? 1);

/**
 * One table of captures and one of environment probes, a column per run.
 * @param {string} outRoot
 * @returns {string}
 */
function renderSummary(outRoot) {
  const runs = fs.existsSync(outRoot)
    ? fs
        .readdirSync(outRoot)
        .filter((d) => fs.existsSync(path.join(outRoot, d, "meta.json")))
        .sort()
        .map((d) => ({ dir: d, meta: JSON.parse(fs.readFileSync(path.join(outRoot, d, "meta.json"), "utf8")) }))
    : [];
  if (runs.length === 0) return "## Screenshots\n\nNo capture produced a `meta.json`.\n";

  /** @param {unknown} v */
  const cell = (v) => (v === undefined || v === null || v === "" ? "—" : String(v).replace(/\|/g, "\\|").replace(/\n/g, " "));
  const head = (title) => `| ${title} | ${runs.map((r) => `\`${r.dir}\``).join(" | ")} |\n|---|${runs.map(() => "---").join("|")}|\n`;
  /** @param {string} label @param {(m: any) => unknown} pick */
  const row = (label, pick) => `| ${label} | ${runs.map((r) => cell(safe(() => pick(r.meta)))).join(" | ")} |\n`;

  const scenes = ["base", "palette", "toast", "focus-tree"];
  let md = "## Screenshots\n\nA viewing tool: nothing is compared or gated. Artifacts are `screenshots-<os>-<theme>`.\n\n";
  md += head("Scene");
  for (const s of scenes) {
    md += row(s, (m) => {
      const r = (m.scenes ?? []).find((x) => x.scene === s);
      if (!r) return "missing";
      return r.stable ? `${r.file} (stable after ${r.attempts})` : `${r.file} (unstable: ${r.lastDiff?.changed} px changing at ${r.lastDiff?.box})`;
    });
  }
  md += row("error", (m) => (m.error ? m.error.split("\n")[0] : ""));

  md += "\n" + head("Probe");
  md += row("theme (sl / theia)", (m) => `${m.theme?.slTheme} / ${m.theme?.theiaBodyClass} ${m.theme?.confirmed ? "✓" : "✗"}`);
  md += row("theme route", (m) => m.themeRoute);
  md += row("deployed plugins (backend log)", (m) => m.log?.deployedPlugins);
  md += row("missing plugin paths", (m) => (m.log?.missingPluginPaths ?? []).join(", ") || "none");
  md += row("extensions (API)", (m) => m.extensions?.extensions?.length);
  md += row("WebGL2", (m) => (m.webglAttempts ?? []).map((a) => `${a.swiftshader ? "swiftshader" : "default"}: ${a.webgl2}`).join("; "));
  md += row("xterm renderer", (m) => `${m.page?.xtermRenderer} (${m.page?.xtermDetail})`);
  md += row('fonts.check 13px "Geist Mono"', (m) => `${m.readiness?.geistMonoCheck} after ${m.readiness?.fontsMs ?? "timeout"} ms`);
  md += row("Geist Mono faces", (m) => (m.readiness?.geistMonoFaces ?? []).join("; ") || "none declared");
  md += row("editor font", (m) => m.page?.editorFont);
  md += row("Monaco char width", (m) => m.page?.monacoCharWidth);
  md += row("devicePixelRatio", (m) => m.page?.devicePixelRatio);
  md += row("viewport / content size", (m) => `${m.page?.innerSize} / ${m.main?.contentSize}`);
  md += row("titleBarStyle", (m) => `top panel ${m.page?.topPanelVisible ? "shown" : "hidden"}, window controls ${m.page?.windowControls ? "in page" : "native"}`);
  md += row("document.hasFocus", (m) => m.page?.hasFocus);
  md += row("tree focused (focus-tree)", (m) => m.treeFocused);
  md += row("bottom panel opened by the scene", (m) => m.bottomPanelOpened);
  md += row("editor top line (base)", (m) => {
    const scroll = m.scenes?.find((x) => x.scene === "base")?.ack?.scroll;
    return `${m.baseFirstVisibleLine} in the gutter; API ${scroll?.topLine} via ${scroll?.how}`;
  });
  md += row("bottom panel terminals", (m) => {
    const t = m.scenes?.find((x) => x.scene === "base")?.ack?.terminal;
    return t ? `${t.names.join(", ")}; shown: ${t.shown}` : "";
  });
  md += row("infinite animations paused", (m) => (m.scenes ?? []).map((x) => `${x.scene} ${x.pausedLoops}`).join(", "));
  md += row("TypeScript symbols (base)", (m) => {
    const lang = m.scenes?.find((x) => x.scene === "base")?.ack?.language;
    return lang ? `${lang.symbols} after ${lang.waitedMs} ms` : "";
  });
  md += row("layout ready", (m) => `${m.readiness?.layoutMs} ms`);
  md += row("Electron / Chromium", (m) => `${m.main?.electron} / ${m.main?.chromium}`);
  md += row("platform", (m) => m.main?.platform);
  md += row("native capture (mac)", (m) => (m.native ?? []).map((n) => `${n.mode}: ${n.ok ? n.size : `failed ${n.error ?? ""}`}`).join("; "));
  md += row("close", (m) => m.close);
  return md + "\n";
}

/** @param {() => unknown} fn */
function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
