import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { ACCENT, accentText } from "./spexr-accent.js";
import { SELECTION_ALPHA, withAlpha } from "./spexr-monaco-theme.js";
import type { SpexrThemeKind } from "./spexr-theme-ids.js";

/** The sixteen ANSI colour ids of Theia's terminal, in xterm's order (index 0-15). */
export const TERMINAL_ANSI_IDS = [
  "terminal.ansiBlack",
  "terminal.ansiRed",
  "terminal.ansiGreen",
  "terminal.ansiYellow",
  "terminal.ansiBlue",
  "terminal.ansiMagenta",
  "terminal.ansiCyan",
  "terminal.ansiWhite",
  "terminal.ansiBrightBlack",
  "terminal.ansiBrightRed",
  "terminal.ansiBrightGreen",
  "terminal.ansiBrightYellow",
  "terminal.ansiBrightBlue",
  "terminal.ansiBrightMagenta",
  "terminal.ansiBrightCyan",
  "terminal.ansiBrightWhite",
] as const;

/**
 * How far a bright colour moves from its hue toward the primary ink. On dark
 * the primary ink is light, so a bright hue is lighter; on light it is dark, so
 * a bright hue is darker (a deeper red, not a paler one). Either way its
 * contrast only rises.
 */
export const BRIGHT_MIX = 0.3;

/** `#rrggbb` mixed toward another by `t` (0-1), per sRGB channel. */
export function mixHex(from: string, toward: string, t: number): string {
  const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(from, i) + (channel(toward, i) - channel(from, i)) * t).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Theia's terminal colours for a theme, by colour id, every one from a kit role.
 *
 * - **Hues** are the kit's syntax hues, the demo's own: red the `number`, green
 *   the `string`, yellow the `builtin`, magenta the `keyword`, cyan the
 *   `function`; blue is the accent as text. The kit gates each at 4.5:1 on
 *   the surface the terminal sits on. A bright hue is that hue moved 30%
 *   toward the primary ink, which only raises its contrast.
 * - **Greys** are the ink ladder. White is the secondary ink (the demo's
 *   output colour) and bright white the primary; bright black is the muted
 *   ink, which dim text is drawn in. Black is a ground colour, used for
 *   inverse text on a fill: the tile rung on dark, the primary ink on light,
 *   so it is not text and is not held to the text floor.
 * - The default foreground is the secondary ink, the demo's output colour;
 *   the cursor is the accent; a selection is the accent painted at 17%.
 */
export function terminalColors(theme: SpexrThemeKind): Record<string, string> {
  const r = kitNeutrals.products.spexr[theme];
  const primary = r["text-primary"];
  const hues = {
    red: r["code-number"],
    green: r["code-string"],
    yellow: r["code-builtin"],
    blue: accentText(theme),
    magenta: r["code-keyword"],
    cyan: r["code-function"],
  };
  const bright = (hex: string): string => mixHex(hex, primary, BRIGHT_MIX);
  return {
    "terminal.foreground": r["text-secondary"],
    "terminalCursor.foreground": ACCENT[theme],
    "terminal.selectionBackground": withAlpha(ACCENT[theme], SELECTION_ALPHA),
    "terminal.ansiBlack": theme === "dark" ? r["bg-tile"] : primary,
    "terminal.ansiRed": hues.red,
    "terminal.ansiGreen": hues.green,
    "terminal.ansiYellow": hues.yellow,
    "terminal.ansiBlue": hues.blue,
    "terminal.ansiMagenta": hues.magenta,
    "terminal.ansiCyan": hues.cyan,
    "terminal.ansiWhite": r["text-secondary"],
    "terminal.ansiBrightBlack": r["text-muted"],
    "terminal.ansiBrightRed": bright(hues.red),
    "terminal.ansiBrightGreen": bright(hues.green),
    "terminal.ansiBrightYellow": bright(hues.yellow),
    "terminal.ansiBrightBlue": bright(hues.blue),
    "terminal.ansiBrightMagenta": bright(hues.magenta),
    "terminal.ansiBrightCyan": bright(hues.cyan),
    "terminal.ansiBrightWhite": primary,
  };
}
