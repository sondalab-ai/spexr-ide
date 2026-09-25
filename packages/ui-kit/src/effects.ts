/**
 * The Sondalab effects runtime (Tier 1): the specular edge on glass, the press
 * light, and the live light on a working aurora. A subpath of its own, never
 * the package root: the kit ships it as an ES module for the browser, and the
 * root is also loaded on the Node side.
 */
export { mount } from "@sondalab/ui-kit/effects.js";
