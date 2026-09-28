/**
 * The Sondalab halftone core: samples a picture into dots and places each dot
 * at a time. A subpath of its own, like ./effects, since the kit ships it as
 * an ES module for the browser.
 */
export { sampleDots, dotFrame, settledFrame, cover } from "@sondalab/ui-kit/halftone-core.js";
export type { Dot, DotFrame, Motion, SampleOptions } from "@sondalab/ui-kit/halftone-core.js";
