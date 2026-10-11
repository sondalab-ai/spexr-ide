/**
 * Registry of views that must be revealed on every launch, even when Theia
 * restores a previously-saved shell layout.
 *
 * Why this exists: in Electron, Theia's shell-layout cache (`localStorage`
 * key `theia:layout`) is not scoped per workspace — `LocalStorageService.prefix()`
 * returns the bare key for Electron, so every workspace on a machine shares one
 * cached layout. `AbstractViewContribution.initializeLayout()` (the mechanism
 * that normally opens a view by default) only runs when no layout is cached at
 * all, so a view added to the defaults *after* a user's first-ever SPEXR launch
 * never appears for them again, in any workspace, until they toggle it manually
 * or clear the cache. Any view bound here is force-revealed on every restore to
 * route around that gap — see docs/memory/spexr-multiwindow-limitation.md.
 *
 * To keep a view visible across future default-layout changes, bind it here
 * instead of special-casing `SpexrShellLayoutContribution`:
 *   bind(SpexrRevealOnRestore).toService(SomeViewContribution);
 * `SomeViewContribution` must already exist as a singleton binding (e.g. via
 * `bindViewContribution`) — `toService` aliases it, it does not construct a
 * second instance.
 */
export const SpexrRevealOnRestore = Symbol("SpexrRevealOnRestore");

/** The subset of `AbstractViewContribution` this registry actually needs. */
export interface RevealOnRestoreView {
  openView(options?: { activate?: boolean; reveal?: boolean }): Promise<unknown>;
  /**
   * The view is attached at a restore but not brought to the front of its tab
   * bar: it is a destination the user picks, not what a window opens on (the
   * Darkfactory wall, S6c). An explicit `openView({ reveal: true })` elsewhere
   * still raises it.
   */
  readonly attachBehind?: boolean;
}

/** The options a restore opens a registered view with. */
export function restoreOptions(view: Pick<RevealOnRestoreView, "attachBehind">): { activate: false; reveal: boolean } {
  return { activate: false, reveal: !view.attachBehind };
}
