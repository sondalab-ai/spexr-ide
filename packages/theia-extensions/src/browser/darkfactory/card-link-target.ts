/** The slice of a DOM element this module needs, so tests can pass a fake. */
export interface ClosestLike {
  closest(selector: string): { getAttribute(name: string): string | null } | null;
}

/** Attribute naming the card a pinned card's body belongs to. */
export const CARD_KEY_ATTRIBUTE = "data-card-key";

/**
 * The card whose terminal a link was just clicked in, if any: the focused
 * element must sit inside a card's embedded terminal. Any other focus (the
 * bottom-panel terminal, an editor) returns undefined, and the link keeps
 * opening in the system browser.
 */
export function cardKeyForLinkClick(active: ClosestLike | null | undefined): string | undefined {
  if (!active?.closest(".spexr-df-termhost")) return undefined;
  return active.closest(`[${CARD_KEY_ATTRIBUTE}]`)?.getAttribute(CARD_KEY_ATTRIBUTE) ?? undefined;
}
