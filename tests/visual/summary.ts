import fs from "fs";
import path from "path";
import { OUT_ROOT, type CaptureMeta } from "./meta";
import { SCENES } from "./scenes";

/**
 * Playwright global teardown: summarise every `out/<os>-<theme>/meta.json`
 * as one table of captures and one of environment probes, a column per run.
 * Written to `$GITHUB_STEP_SUMMARY` and printed to the job log, whether the
 * capture passed or not. Nothing here compares images or gates anything.
 */
export default async function summary(): Promise<void> {
  const md = renderSummary(readRuns());
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.info(md);
}

interface Run {
  readonly dir: string;
  readonly meta: CaptureMeta;
}

function readRuns(): Run[] {
  if (!fs.existsSync(OUT_ROOT)) return [];
  return fs
    .readdirSync(OUT_ROOT)
    .filter((dir) => fs.existsSync(path.join(OUT_ROOT, dir, "meta.json")))
    .sort()
    .map((dir) => ({ dir, meta: JSON.parse(fs.readFileSync(path.join(OUT_ROOT, dir, "meta.json"), "utf8")) as CaptureMeta }));
}

function cell(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderSummary(runs: Run[]): string {
  if (runs.length === 0) return "## Screenshots\n\nNo capture produced a `meta.json`.\n";
  const head = (title: string): string =>
    `| ${title} | ${runs.map((r) => `\`${r.dir}\``).join(" | ")} |\n|---|${runs.map(() => "---").join("|")}|\n`;
  const row = (label: string, pick: (m: CaptureMeta) => unknown): string =>
    `| ${label} | ${runs.map((r) => cell(pick(r.meta))).join(" | ")} |\n`;
  const base = (m: CaptureMeta) => m.scenes.find((s) => s.scene === "base")?.ack;

  let md = "## Screenshots\n\nA viewing tool: nothing is compared or gated. Artifacts are `screenshots-<os>-<theme>-<attempt>`.\n\n";
  md += head("Capture");
  md += row("commit (PR head)", (m) => m.provenance.sha.slice(0, 12));
  md += row("ref / event", (m) => `${m.provenance.ref} / ${m.provenance.event}`);
  md += row("run / attempt", (m) => `${m.provenance.runId} / ${m.provenance.attempt}`);
  for (const scene of SCENES) {
    md += row(scene, (m) => {
      const r = m.scenes.find((s) => s.scene === scene);
      if (!r) return "missing";
      return r.stable
        ? `${r.file} (stable after ${r.attempts})`
        : `${r.file} (unstable: ${r.lastDiff?.changed} px changing at ${r.lastDiff?.box})`;
    });
  }
  md += row("error", (m) => (m.error ? m.error.split("\n")[0] : ""));

  md += "\n" + head("Scripted by the capture");
  md += row("bottom panel opened", (m) => m.bottomPanelOpened);
  md += row("bottom panel top edge (demo 666)", (m) => (m.bottomPanel ? m.bottomPanel.top : "not showing"));
  md += row("main tab strips aligned", (m) => m.scenes.map((s) => `${s.scene} ${s.alignedStrips}`).join(", "));
  md += row("infinite animations paused", (m) => m.scenes.map((s) => `${s.scene} ${s.pausedLoops}`).join(", "));
  md += row("editor top line (base)", (m) => `${m.baseFirstVisibleLine} in the gutter; API ${base(m)?.scroll?.topLine} via ${base(m)?.scroll?.how}`);
  md += row("bottom panel terminals", (m) => {
    const t = base(m)?.terminal;
    return t ? `${t.names.join(", ")}; shown: ${t.shown}` : "";
  });

  md += "\n" + head("Probe");
  md += row("theme (sl / theia)", (m) => `${m.themeCheck?.slTheme} / ${m.themeCheck?.theiaBodyClass} ${m.themeCheck?.confirmed ? "✓" : "✗"}`);
  md += row("deployed plugins (backend log)", (m) => m.log?.deployedPlugins);
  md += row("missing plugin paths", (m) =>
    `${(m.log?.missingPluginPaths ?? []).join(", ") || "none"} (plus ${m.log?.userPluginDirsMissing ?? 0} of Theia's per-user plugin folders, expected on a fresh profile)`,
  );
  md += row("extensions (API)", (m) => m.extensions?.extensions?.length);
  md += row("WebGL2", (m) => (m.webglAttempts ?? []).map((a) => `${a.swiftshader ? "swiftshader" : "default"}: ${a.webgl2}`).join("; "));
  md += row("xterm renderer", (m) => (m.page ? `${m.page.xtermRenderer} (${m.page.xtermDetail})` : ""));
  md += row('fonts.check 13px "Geist Mono"', (m) => (m.readiness ? `${m.readiness.geistMonoCheck} after ${m.readiness.fontsMs ?? "timeout"} ms` : ""));
  md += row("Geist Mono faces", (m) => (m.readiness?.geistMonoFaces ?? []).join("; ") || "none declared");
  md += row("editor font", (m) => m.page?.editorFont);
  md += row("Monaco char width", (m) => m.page?.monacoCharWidth);
  md += row("devicePixelRatio", (m) => m.page?.devicePixelRatio);
  md += row("viewport / content size", (m) => `${m.page?.innerSize} / ${m.main?.contentSize}`);
  md += row("titleBarStyle", (m) =>
    m.page
      ? `top panel ${m.page.topPanelVisible ? "shown" : "hidden"}, window controls ${m.page.windowControls ? "in page" : "native"}, traffic lights' room ${m.page.trafficLights ? "kept" : "none"}`
      : "",
  );
  md += row("traffic lights (mac)", (m) => {
    const p = m.main?.windowButtonPosition;
    return p ? `at ${p.x},${p.y}; window ${m.main?.bounds}` : "";
  });
  md += row("traffic lights found (mac)", (m) => {
    const l = m.lights;
    if (!l) return "";
    const circles = l.circles.map((c) => `${c.colour} ${c.left}–${c.right} × ${c.top}–${c.bottom}`).join(", ");
    return `${l.ok ? "✓" : `✗ ${l.problems.join("; ")}`} (${m.main?.systemVersion}, scale ${l.scale}): ${circles}; bar centre ${l.barCentre}`;
  });
  md += row("zoom −1 (mac)", (m) => {
    const z = m.zoom;
    if (!z) return "";
    const p = z.windowButtonPosition;
    const settle = z.settle ? `, frame ${z.settle.settled ? "settled" : "never settled"} after ${z.settle.attempts} capture(s)` : "";
    return `${z.ok ? "✓" : `✗ ${z.problems.join("; ")}`}: room ${z.roomBefore} → ${z.roomAfter}, lights at ${p ? `${p.x},${p.y}` : "?"}, mark ${z.markLeftPt}pt, gap ${z.markGapPt}pt${settle}`;
  });
  md += row("full screen (mac)", (m) => {
    const f = m.fullScreen;
    if (!f) return "";
    const step = (name: string, s?: { event: boolean; answeredMs: number | null; trafficLights: boolean; markX: number | null }): string =>
      s ? `${name}: event ${s.event ? "✓" : "✗"}, bar ${s.answeredMs === null ? "never answered" : `answered in ${s.answeredMs} ms`}, room ${s.trafficLights ? "kept" : "dropped"}, mark x ${s.markX}` : "";
    return [step("enter", f.enter), step("leave", f.leave), f.error ? `error ${f.error}` : ""].filter(Boolean).join("; ");
  });
  md += row("document.hasFocus", (m) => m.page?.hasFocus);
  md += row("tree focused (focus-tree)", (m) => m.treeFocused);
  md += row("TypeScript symbols (base)", (m) => {
    const lang = base(m)?.language;
    return lang ? `${lang.symbols} after ${lang.waitedMs} ms` : "";
  });
  md += row("layout ready", (m) => (m.readiness ? `${m.readiness.layoutMs} ms` : ""));
  md += row("Electron / Chromium", (m) => (m.main ? `${m.main.electron} / ${m.main.chromium}` : ""));
  md += row("platform", (m) => m.main?.platform);
  md += row("native capture (mac)", (m) => (m.native ?? []).map((n) => `${n.mode}: ${n.ok ? n.size : `failed ${n.error ?? ""}`}`).join("; "));
  md += row("close", (m) => m.close);
  return md + "\n";
}
