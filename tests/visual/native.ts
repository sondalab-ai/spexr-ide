import type { ElectronApplication } from "@playwright/test";
import { execFileSync } from "child_process";
import fs from "fs";

export interface NativeShot {
  readonly mode: string;
  readonly file: string;
  readonly ok: boolean;
  /** PNG size in pixels, from its header; null when no file was written. */
  readonly size: string | null;
  readonly error?: string;
}

/**
 * macOS only: capture the window as the system draws it, traffic lights and
 * title bar included, which `page.screenshot()` cannot see.
 *
 * Tries `screencapture -l<CGWindowID>` first; Electron's media source id for a
 * window is `window:<CGWindowID>:0`. Then `-R` with the window's bounds as a
 * fallback. Without Screen Recording permission screencapture may still exit 0
 * and write the desktop without the window, so the summary shows both files
 * next to the page capture rather than trusting the exit code.
 */
export async function nativeCapture(app: ElectronApplication, base: string): Promise<NativeShot[]> {
  const info = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    win.focus();
    return { id: win.getMediaSourceId(), bounds: win.getBounds() };
  });
  if (!info) return [{ mode: "none", file: "", ok: false, size: null, error: "no window" }];
  const shots: NativeShot[] = [];
  const windowId = /^window:(\d+):/.exec(info.id)?.[1];
  if (windowId) shots.push(run("window -l", `${base}-window.png`, ["-x", "-o", `-l${windowId}`]));
  const { x, y, width, height } = info.bounds;
  shots.push(run("rect -R", `${base}-rect.png`, ["-x", `-R${x},${y},${width},${height}`]));
  return shots;
}

function run(mode: string, file: string, args: string[]): NativeShot {
  try {
    execFileSync("screencapture", [...args, file], { stdio: ["ignore", "ignore", "pipe"], timeout: 30_000 });
    return { mode, file: file.split("/").pop() ?? file, ok: fs.existsSync(file), size: pngSize(file) };
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim();
    return { mode, file: file.split("/").pop() ?? file, ok: false, size: pngSize(file), error: stderr || String(err) };
  }
}

/** Width × height from a PNG's IHDR chunk. */
export function pngSize(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const head = fs.readFileSync(file).subarray(0, 24);
  if (head.length < 24) return null;
  return `${head.readUInt32BE(16)}x${head.readUInt32BE(20)}`;
}
