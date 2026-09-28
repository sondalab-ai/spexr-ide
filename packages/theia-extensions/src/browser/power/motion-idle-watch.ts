import { type MotionIdleState, motionPaused, msUntilIdle } from "./motion-idle-state.js";

const POINTER_EVENTS = ["pointerdown", "pointermove", "wheel"] as const;

/**
 * Follow whether anyone is looking at the window and call `apply` when the
 * answer flips: paused while unfocused or hidden, or after the idle window
 * without input (motion-idle-state.ts decides). Input handlers only stamp the
 * time; a single timer re-checks at the idle deadline. Returns a stop
 * function that removes every listener and timer.
 */
export function watchMotionIdle(win: Window, doc: Document, apply: (paused: boolean) => void): () => void {
  const state: MotionIdleState = { focused: doc.hasFocus(), hidden: doc.hidden, lastInputAt: Date.now() };
  let paused = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanups: Array<() => void> = [];

  const listen = (target: EventTarget, type: string, handler: () => void, options?: AddEventListenerOptions): void => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  const update = (): void => {
    const now = Date.now();
    const next = motionPaused(state, now);
    if (next !== paused) {
      paused = next;
      apply(paused);
    }
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = paused ? undefined : setTimeout(update, msUntilIdle(state.lastInputAt, now));
  };

  const onInput = (): void => {
    state.lastInputAt = Date.now();
    if (!paused) return;
    // Re-read focus rather than trust the last event: a background window
    // still gets pointer moves, and a focus change can predate the watch.
    state.focused = doc.hasFocus();
    update();
  };
  for (const type of POINTER_EVENTS) listen(win, type, onInput, { capture: true, passive: true });
  listen(win, "keydown", onInput, { capture: true });
  listen(win, "focus", () => {
    state.focused = true;
    state.lastInputAt = Date.now();
    update();
  });
  // Focus moving into a webview iframe blurs this window too, while the app
  // keeps OS focus; hasFocus() tells the two apart once focus settles.
  listen(win, "blur", () => {
    if (blurTimer !== undefined) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      blurTimer = undefined;
      state.focused = doc.hasFocus();
      update();
    }, 0);
  });
  listen(doc, "visibilitychange", () => {
    state.hidden = doc.hidden;
    update();
  });
  update();

  return () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    if (blurTimer !== undefined) clearTimeout(blurTimer);
    idleTimer = blurTimer = undefined;
  };
}
