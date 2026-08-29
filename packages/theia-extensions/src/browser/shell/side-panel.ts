/**
 * The part of Theia's `ApplicationShell` these helpers actually touch.
 *
 * Structural rather than nominal so callers can be unit-tested with a plain
 * object — importing `ApplicationShell` as a value drags in Lumino's DOM code.
 */
export interface SidePanelShell {
  readonly leftPanelHandler: unknown;
  readonly rightPanelHandler: unknown;
}

/** Minimum width (px) for the left side panel that hosts the agent terminal. */
export const MIN_LEFT_PANEL_WIDTH = 480;

/** Minimum width (px) for the right side panel that hosts spec/memory/experts. */
export const MIN_RIGHT_PANEL_WIDTH = 400;

type PanelSide = "left" | "right";

interface SidePanelHandlerLike {
  expand?: () => void;
  resize?: (size: number) => void;
  getPanelSize?: () => number | undefined;
  readonly state?: { pendingUpdate?: Promise<unknown> };
}

/**
 * Expand a side panel and enforce a usable minimum width.
 *
 * Lumino positions split children with an explicit inline width, so a CSS
 * `min-width` is ignored. The floor is applied through the handler's `resize`
 * API after the expand animation settles, leaving a wider user-chosen width
 * untouched.
 *
 * @param shell  The application shell.
 * @param side   Which side panel to expand.
 * @param min    Minimum width in pixels to enforce.
 * @returns Resolves once the expansion has settled, so callers that later read
 *   the panel's expansion state do not observe the mid-animation value.
 */
export async function expandSidePanelWithMinWidth(
  shell: SidePanelShell,
  side: PanelSide,
  min: number,
): Promise<void> {
  const raw = side === "left" ? shell.leftPanelHandler : shell.rightPanelHandler;
  const handler = raw as unknown as SidePanelHandlerLike | undefined;
  if (typeof handler?.expand !== "function") return;
  handler.expand();
  await handler.state?.pendingUpdate;
  const size = handler.getPanelSize?.();
  if (typeof size !== "number" || size < min) {
    handler.resize?.(min);
  }
}

/** Expand the left side panel and enforce {@link MIN_LEFT_PANEL_WIDTH}. */
export function expandLeftPanelWithMinWidth(shell: SidePanelShell): Promise<void> {
  return expandSidePanelWithMinWidth(shell, "left", MIN_LEFT_PANEL_WIDTH);
}

/** Expand the right side panel and enforce {@link MIN_RIGHT_PANEL_WIDTH}. */
export function expandRightPanelWithMinWidth(shell: SidePanelShell): Promise<void> {
  return expandSidePanelWithMinWidth(shell, "right", MIN_RIGHT_PANEL_WIDTH);
}
