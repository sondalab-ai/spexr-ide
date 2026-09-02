/** The three terminal families SPEXR styles apart. */
export const SPEXR_TERMINAL_KINDS = ["session", "agent", "editor"] as const;

export type SpexrTerminalKind = (typeof SPEXR_TERMINAL_KINDS)[number];

/**
 * Markers written into `TerminalWidgetOptions.kind` at creation. `kind` is a
 * free-form string on Theia's public options, which makes it the one supported
 * place to record what a terminal is for.
 */
export const SESSION_TERMINAL_KIND = "spexr-session";
export const AGENT_TERMINAL_KIND = "spexr-agent";

/** Which family a widget belongs to. Anything unmarked is an ordinary Theia terminal. */
export function terminalKindOf(widgetKind: string | undefined): SpexrTerminalKind {
  if (widgetKind === SESSION_TERMINAL_KIND) return "session";
  if (widgetKind === AGENT_TERMINAL_KIND) return "agent";
  return "editor";
}

/** Cursor shapes xterm accepts. */
export const CURSOR_STYLES = ["block", "underline", "bar"] as const;

export type CursorStyle = (typeof CURSOR_STYLES)[number];

/** A per-family style. Every field is optional: absent means "inherit Theia's own". */
export interface TerminalStyle {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly cursorStyle?: CursorStyle;
  /** Read from the tri-state preference: "on", "off", or unset to inherit. */
  readonly cursorBlink?: boolean;
  readonly background?: string;
  readonly foreground?: string;
}

/** Preference key holding one field of one family's style. */
export function terminalStyleKey(kind: SpexrTerminalKind, field: keyof TerminalStyle): string {
  return `spexr.terminal.${kind}.${field}`;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Read one family's style from the preference service, dropping anything unset
 * or unusable. An empty string is how a Theia preference says "not set", so it
 * has to mean inherit rather than "no font".
 */
export function readTerminalStyle(
  read: (key: string) => unknown,
  kind: SpexrTerminalKind,
): TerminalStyle {
  const at = (field: keyof TerminalStyle): unknown => read(terminalStyleKey(kind, field));
  const fontFamily = text(at("fontFamily"));
  const fontSize = positive(at("fontSize"));
  const lineHeight = positive(at("lineHeight"));
  const rawLetterSpacing = at("letterSpacing");
  const letterSpacing =
    typeof rawLetterSpacing === "number" && Number.isFinite(rawLetterSpacing) && rawLetterSpacing !== 0
      ? rawLetterSpacing
      : undefined;
  const rawCursor = text(at("cursorStyle"));
  const cursorStyle = CURSOR_STYLES.find((c) => c === rawCursor);
  const rawBlink = text(at("cursorBlink"));
  const background = text(at("background"));
  const foreground = text(at("foreground"));
  return {
    ...(fontFamily !== undefined ? { fontFamily } : {}),
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(lineHeight !== undefined ? { lineHeight } : {}),
    ...(letterSpacing !== undefined ? { letterSpacing } : {}),
    ...(cursorStyle !== undefined ? { cursorStyle } : {}),
    ...(rawBlink === "on" ? { cursorBlink: true } : rawBlink === "off" ? { cursorBlink: false } : {}),
    ...(background !== undefined ? { background } : {}),
    ...(foreground !== undefined ? { foreground } : {}),
  };
}

/** The xterm options a style sets, ready to assign. Colours are not here — they live in the theme. */
export function xtermOptions(style: TerminalStyle): Record<string, unknown> {
  const { background: _bg, foreground: _fg, ...options } = style;
  return { ...options };
}

/**
 * The xterm theme to use, or undefined when the style leaves colours alone.
 * Returning undefined matters: assigning a theme redraws the terminal, so a
 * family that only changes its font must not touch it.
 */
export function xtermTheme(
  style: TerminalStyle,
  base: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> | undefined {
  if (style.background === undefined && style.foreground === undefined) return undefined;
  return {
    ...base,
    ...(style.background !== undefined ? { background: style.background } : {}),
    ...(style.foreground !== undefined ? { foreground: style.foreground } : {}),
  };
}
