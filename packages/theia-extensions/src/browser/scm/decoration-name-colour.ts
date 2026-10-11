/**
 * Whether a decoration colours the name of the row it marks (S6b, L7).
 *
 * Lumen's Explorer marks a changed file with a coloured letter and leaves
 * its name in the row's own ink. Theia's file-tree adapter gives the name and
 * the letter the same colour, so spexr's adapter drops the name's for every
 * decoration but git's "ignored" one, which is the dimming of a name and
 * carries no letter (git-ignored-decoration-provider.ts).
 */
export const NAME_COLOURING_COLOR_IDS: ReadonlySet<string> = new Set(["disabledForeground"]);

/** True when the decoration with this colour id colours the row's name as well as its letter. */
export function colorsName(colorId: string | undefined): boolean {
  return colorId !== undefined && NAME_COLOURING_COLOR_IDS.has(colorId);
}
