import { describe, expect, it } from "vitest";
import { cardKeyForLinkClick, type ClosestLike } from "./card-link-target.js";

/** A fake focused element that sits inside the given selectors. */
function focusedIn(within: Record<string, string | null>): ClosestLike {
  return {
    closest: (selector) =>
      selector in within ? { getAttribute: () => within[selector] ?? null } : null,
  };
}

describe("cardKeyForLinkClick", () => {
  it("names the card whose terminal has focus", () => {
    const active = focusedIn({ ".spexr-df-termhost": null, "[data-card-key]": "s1" });
    expect(cardKeyForLinkClick(active)).toBe("s1");
  });

  it("ignores focus in a card outside its terminal, such as the browser's address field", () => {
    expect(cardKeyForLinkClick(focusedIn({ "[data-card-key]": "s1" }))).toBeUndefined();
  });

  it("ignores a terminal that is not in a card", () => {
    expect(cardKeyForLinkClick(focusedIn({ ".spexr-df-termhost": null }))).toBeUndefined();
  });

  it("ignores no focus at all", () => {
    expect(cardKeyForLinkClick(null)).toBeUndefined();
  });
});
