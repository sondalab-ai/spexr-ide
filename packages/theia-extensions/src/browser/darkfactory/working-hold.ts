import type { AgentTile } from "../../common/darkfactory-protocol.js";

/** How long a card keeps showing "working" after its work stops. */
export const WORKING_HOLD_MS = 4_000;

/**
 * Softens a card leaving "working". A turn that ends swaps the card's moving
 * light and accent status for a still border and a muted one at once, and a
 * session that answers and carries on flips back seconds later. A card seen
 * working in the last {@link WORKING_HOLD_MS} keeps showing working, unless it
 * now fails or is blocked on a prompt: those show at once. Entering "working"
 * is never delayed.
 */
export class WorkingHold {
  private readonly lastWorking = new Map<string, number>();

  /**
   * The tiles as the wall should show them at `now`, and when the earliest
   * hold runs out, so the caller can show the card's real state then.
   */
  apply(tiles: readonly AgentTile[], now: number): { tiles: AgentTile[]; nextExpiry?: number } {
    const present = new Set(tiles.map((t) => t.sessionId));
    for (const id of this.lastWorking.keys()) if (!present.has(id)) this.lastWorking.delete(id);
    let nextExpiry: number | undefined;
    const shown = tiles.map((t): AgentTile => {
      if (t.state === "working") {
        this.lastWorking.set(t.sessionId, now);
        return t;
      }
      const since = this.lastWorking.get(t.sessionId);
      if (since === undefined || t.lastFailed || t.needsYouCertain) return t;
      const expiry = since + WORKING_HOLD_MS;
      if (now >= expiry) {
        this.lastWorking.delete(t.sessionId);
        return t;
      }
      nextExpiry = Math.min(nextExpiry ?? expiry, expiry);
      return { ...t, state: "working", needsYou: false, needsYouCertain: false };
    });
    return nextExpiry === undefined ? { tiles: shown } : { tiles: shown, nextExpiry };
  }
}
