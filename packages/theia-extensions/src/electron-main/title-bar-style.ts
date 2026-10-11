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
 * is kept. macOS stays "native" for Theia: the system menu bar, native
 * context menus, no window controls in the page. Its window hides the
 * system's title bar all the same (macWindowChrome, common/mac-title-bar.ts),
 * which is a window option, not a frame style.
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

/** The slice of Theia's electron-store the startup decision reads and writes. */
export interface TitleBarStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

/** What the main process knows apart from the store. */
export type TitleBarEnvironment = Pick<TitleBarInputs, "platform" | "forceCustom" | "configured">;

/**
 * Decide the style from the store and write the decision back: drop the
 * stored frame, then set the migration flag. Runs on the startup path, before
 * any window opens, so a failed write (a full disk, a read-only profile) is
 * reported and never thrown, as Theia's saveWindowState does.
 *
 * - If the frame cannot be dropped, the store still holds it, and Theia's
 *   getLastWindowOptions will open the window with it: the style returned is
 *   then the one that frame implies, so the page and the window agree, and
 *   the flag stays unset so the next launch tries again.
 * - If only the flag cannot be written, this run is right, and the next one
 *   migrates again. That finds no frame to drop, unless the user chose
 *   `native` in between: their stored frame is then dropped too, and they
 *   are back on the custom bar once more.
 */
export function applyTitleBarStyle(
  store: TitleBarStore,
  env: TitleBarEnvironment,
  report: (message: string, error: unknown) => void = (message, error) => console.warn(message, error),
): TitleBarStyle {
  const windowState = store.get("windowstate") as ({ frame?: boolean } & Record<string, unknown>) | undefined;
  const inputs: TitleBarInputs = { ...env, storedFrame: windowState?.frame, migrated: store.get(TITLE_BAR_MIGRATION_KEY) === true };
  const decision = decideTitleBarStyle(inputs);
  const write = (what: string, key: string, value: unknown): boolean => {
    try {
      store.set(key, value);
      return true;
    } catch (error) {
      report(`[spexr] could not ${what} in the window state store`, error);
      return false;
    }
  };
  if (decision.dropStoredFrame && windowState) {
    const { frame: _dropped, ...rest } = windowState;
    if (!write("drop the stored window frame", "windowstate", rest)) return decideTitleBarStyle({ ...inputs, migrated: true }).style;
  }
  if (decision.markMigrated) write("record the title bar migration", TITLE_BAR_MIGRATION_KEY, true);
  return decision.style;
}
