import { ViewContainerPart } from "@theia/core/lib/browser/view-container";
import type { ViewContainer } from "@theia/core/lib/browser/view-container";
import { exceedsShare, partShareWeights } from "./part-share.js";

/**
 * A part's measured height without its header, which is the measure
 * `getAvailableSize` is expressed in. Theia's own `doStoreState` corrects the
 * same way before saving a relative size.
 */
function contentSize(measured: number | undefined): number | undefined {
  if (measured === undefined) return undefined;
  return measured > ViewContainerPart.HEADER_HEIGHT ? measured - ViewContainerPart.HEADER_HEIGHT : measured;
}

/**
 * Cap one section of a view container at `share` of the container's height.
 *
 * A part restored with no relative size of its own is weighted with the average
 * of its neighbours, which against a single other section is half the panel —
 * usually far more than a list of names or a search box needs. This gives it the
 * share it should have and splits the rest between the others.
 *
 * It is a cap, not an assignment: a section already at or below its share is left
 * alone, so a user who has dragged it smaller keeps that. See {@link exceedsShare}
 * for the margin that keeps an already-capped section from being re-sized on every
 * launch.
 *
 * Deferred to the container's first visibility change when the container has not
 * been laid out yet — a side-panel view that is not the active one has no height,
 * and `setPartSizes` on a zero-height container silently does nothing. The
 * listener is one-shot, so it cannot fight a size the user sets later.
 */
export function applyPartShare(container: ViewContainer, part: ViewContainerPart, share: number): void {
  const layout = container.containerLayout;
  const apply = (): boolean => {
    const available = layout.getAvailableSize();
    if (available <= 0) return false; // not laid out yet — nothing to decide on
    if (exceedsShare(contentSize(layout.getPartSize(part)), available, share)) {
      const parts = container.getParts();
      const weights = partShareWeights(
        parts.map((p) => !p.isHidden && !p.collapsed),
        parts.indexOf(part),
        share,
      );
      if (weights.some((w) => w !== undefined)) layout.setPartSizes(weights);
    }
    return true;
  };
  if (apply()) return;
  const pending = container.onDidChangeVisibility(() => {
    if (apply()) pending.dispose();
  });
}
