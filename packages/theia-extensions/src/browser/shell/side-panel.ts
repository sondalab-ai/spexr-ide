import { areaSize } from "./workbench-geometry.js";

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

/**
 * Narrowest left island (px) while it shows the agent terminal: the 432px it
 * had when the floor was Theia's 480 with a 48px activity bar.
 */
export const MIN_LEFT_ISLAND_WIDTH = 432;

/** Narrowest right island (px), for spec/memory/experts: Lumen's agent pane, 352. */
export const MIN_RIGHT_ISLAND_WIDTH = 352;

/**
 * The floors as Theia measures a side (workbench-geometry.ts, `areaSize`):
 * the left one includes the activity column, the right one the split handle
 * and the column too.
 */
export const MIN_LEFT_PANEL_SIZE = areaSize("left", MIN_LEFT_ISLAND_WIDTH);
export const MIN_RIGHT_PANEL_SIZE = areaSize("right", MIN_RIGHT_ISLAND_WIDTH);

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

/**
 * Expand a side panel at whatever size it has, with no floor. Resolves once
 * the expansion has settled.
 */
export async function expandSidePanel(shell: SidePanelShell, side: PanelSide): Promise<void> {
  const raw = side === "left" ? shell.leftPanelHandler : shell.rightPanelHandler;
  const handler = raw as unknown as SidePanelHandlerLike | undefined;
  if (typeof handler?.expand !== "function") return;
  handler.expand();
  await handler.state?.pendingUpdate;
}

/** Expand the left side panel and enforce {@link MIN_LEFT_ISLAND_WIDTH} (as {@link MIN_LEFT_PANEL_SIZE}). */
export function expandLeftPanelWithMinWidth(shell: SidePanelShell): Promise<void> {
  return expandSidePanelWithMinWidth(shell, "left", MIN_LEFT_PANEL_SIZE);
}

/** The part of Theia's `ApplicationShell` {@link keepAgentFloor} reads, besides the side handlers. */
export interface AgentFloorShell extends SidePanelShell {
  getCurrentWidget(area: "left"): { readonly id: string } | undefined;
}

/**
 * After the first launch's sizes: when the left view in front is the agent
 * terminal (`agentId`), give it back its floor, {@link MIN_LEFT_ISLAND_WIDTH}.
 * Lumen's 264px island is the Explorer's; the agent terminal at that width
 * would be about 33 columns. With the Explorer, or any other view, in front,
 * nothing changes.
 *
 * @returns whether the floor was applied.
 */
export async function keepAgentFloor(shell: AgentFloorShell, agentId: string): Promise<boolean> {
  if (shell.getCurrentWidget("left")?.id !== agentId) return false;
  await expandLeftPanelWithMinWidth(shell);
  return true;
}

/** Expand the right side panel and enforce {@link MIN_RIGHT_ISLAND_WIDTH} (as {@link MIN_RIGHT_PANEL_SIZE}). */
export function expandRightPanelWithMinWidth(shell: SidePanelShell): Promise<void> {
  return expandSidePanelWithMinWidth(shell, "right", MIN_RIGHT_PANEL_SIZE);
}
