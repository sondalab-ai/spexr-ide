import { injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { applyMotionPaused } from "./power-save-dom.js";
import { watchMotionIdle } from "./motion-idle-watch.js";

/**
 * Pauses decorative motion while nobody is looking: the window is unfocused
 * or hidden, or has had no input for a while (motion-idle-watch.ts).
 */
@injectable()
export class SpexrMotionIdleContribution implements FrontendApplicationContribution {
  private stop: (() => void) | undefined;

  onStart(): void {
    this.stop = watchMotionIdle(window, document, (paused) => applyMotionPaused(paused));
  }

  onStop(): void {
    this.stop?.();
    this.stop = undefined;
  }
}
