import { ViewContainerPart } from "@theia/core/lib/browser/view-container";
import { WORKBENCH } from "./workbench-geometry.js";

/**
 * Make Theia's view-container section header the geometry table's
 * {@link WORKBENCH.sectionHead} (S6b, Lumen's eyebrow header).
 *
 * Theia keeps the header's height in two places: the CSS variable
 * `--theia-view-container-title-height` (spexr.css sets it), which sizes a
 * section's body, and `ViewContainerPart.HEADER_HEIGHT`, a static the layout
 * reads as a collapsed section's height and when it stores sizes. A header
 * drawn at one height and a collapsed slot at the other would clip it. The
 * static is read when a container's layout is made, so this runs when the
 * frontend module loads, before any container exists.
 */
export function applySectionHeaderHeight(): void {
  (ViewContainerPart as unknown as { HEADER_HEIGHT: number }).HEADER_HEIGHT = WORKBENCH.sectionHead;
}
