/** The window frame Theia builds: the system's, or none with spexr's own title bar. */
export type TitleBarStyle = "native" | "custom";

/**
 * The electron-store key recording that the one-time title bar migration ran.
 * Flat on purpose: electron-store reads a dotted key as a nested path.
 */
export const TITLE_BAR_MIGRATION_KEY = "spexrCustomTitleBarMigrated";

/** What the main process knows at startup, before the first window opens. */
export interface TitleBarInputs {
  readonly platform: string;
  /** `THEIA_ELECTRON_DISABLE_NATIVE_ELEMENTS=1`, which Theia honours before anything else. */
  readonly forceCustom: boolean;
  /** `windowstate.frame` as Theia stored it at the last window close or style change. */
  readonly storedFrame: boolean | undefined;
  /** Whether {@link TITLE_BAR_MIGRATION_KEY} is already set. */
  readonly migrated: boolean;
  /** The application config's `window.titleBarStyle` (apps/desktop/package.json), if any. */
  readonly configured: unknown;
}

export interface TitleBarDecision {
  readonly style: TitleBarStyle;
  /**
   * Delete `frame` from the stored window state. Theia's getLastWindowOptions
   * spreads that state over the frame it computed, so an ignored frame has to
   * leave the store, not only this decision.
   */
  readonly dropStoredFrame: boolean;
  /** Set {@link TITLE_BAR_MIGRATION_KEY}: on the first run of this version, a fresh install included. */
  readonly markMigrated: boolean;
}

/**
 * The title bar style for this run: Theia's precedence (forced, macOS, the
 * stored frame, the app config), with spexr's custom frame as the default on
 * Windows and Linux instead of Theia's native one on Linux.
 *
 * On Linux the stored frame is ignored once, at the first run after this
 * change: Linux used to default to the native frame, so a stored `true` there
 * is Theia's old default rather than a choice. From then on a stored frame is
 * one Theia wrote through setTitleBarStyle, i.e. the user's
 * `window.titleBarStyle`, and it wins again, so `native` stays an escape hatch.
 * Windows already defaulted to custom, so a stored `true` there was chosen and
 * is kept. macOS keeps its native frame (S5b-2 brings its inset title bar).
 */
export function decideTitleBarStyle(inputs: TitleBarInputs): TitleBarDecision {
  const markMigrated = !inputs.migrated;
  const dropStoredFrame = markMigrated && inputs.platform === "linux" && inputs.storedFrame === true;
  const storedFrame = dropStoredFrame ? undefined : inputs.storedFrame;
  return { style: styleFrom(inputs, storedFrame), dropStoredFrame, markMigrated };
}

/** Theia 1.75's getTitleBarStyle order, ending in spexr's default. */
function styleFrom(inputs: TitleBarInputs, storedFrame: boolean | undefined): TitleBarStyle {
  if (inputs.forceCustom) return "custom";
  if (inputs.platform === "darwin") return "native";
  if (storedFrame !== undefined) return storedFrame ? "native" : "custom";
  if (inputs.configured === "native" || inputs.configured === "custom") return inputs.configured;
  return "custom";
}
