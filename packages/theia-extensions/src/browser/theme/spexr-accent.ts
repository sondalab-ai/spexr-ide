/**
 * SPEXR's registered accent fill (the kit's --slc-accent-fill, set in
 * spexr-overrides.css): what an accent fill that carries a white label is
 * painted with, on both themes. White on it reads 5.41:1, where white on the
 * #5b6cff accent reads 4.17.
 */
export const ACCENT_FILL = "#4c58e9";

/**
 * `color-mix(in srgb, <hex> <keep>, black)` as a hex, for the registry, which
 * wants a plain colour: the fill's hover keeps 89% (white on it: 6.47:1).
 */
export function mixBlack(hex: string, keep: number): string {
  return `#${[1, 3, 5]
    .map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * keep).toString(16).padStart(2, "0"))
    .join("")}`;
}
