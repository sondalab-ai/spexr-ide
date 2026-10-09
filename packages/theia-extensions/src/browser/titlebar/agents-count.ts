import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { WorkingHold } from "../darkfactory/working-hold.js";
import { runningAgents } from "./titlebar-model.js";

/** What the badge shows, and when the earliest hold runs out (to show the real count then). */
export interface AgentsView {
  readonly count: number;
  readonly nextExpiry?: number;
}

/**
 * The agents badge's count, kept free of Theia. Tiles arrive two ways:
 * Dark Factory's pushes, which reach only the newest window, and reads of the
 * backend's last scan (`currentTiles`, no scan of its own) when a window is
 * built or comes to the front.
 *
 * - The count goes through the wall's {@link WorkingHold}, so the badge says
 *   what the wall's cards say and does not flicker as a turn ends.
 * - One read at a time: {@link startRead} refuses while one is in flight.
 * - Every accepted update bumps a generation, and a read's result counts only
 *   if nothing was accepted since it started: a push that lands meanwhile is
 *   at least as new, so the older read cannot overwrite it.
 */
export class AgentsCount {
  private readonly hold = new WorkingHold();
  private generation = 0;
  private reading: number | undefined;
  private last: readonly AgentTile[] = [];

  /** A pushed scan: the newest picture there is, so it is always taken. */
  push(tiles: readonly AgentTile[], now: number): AgentsView {
    this.generation++;
    return this.show(tiles, now);
  }

  /** A token for a read of the last scan, or undefined while one is already in flight. */
  startRead(): number | undefined {
    if (this.reading !== undefined) return undefined;
    this.reading = this.generation;
    return this.reading;
  }

  /**
   * A read's result; undefined (nothing to show) when it failed or when an
   * update was accepted after it started.
   */
  finishRead(token: number, tiles: readonly AgentTile[] | undefined, now: number): AgentsView | undefined {
    if (this.reading === token) this.reading = undefined;
    if (!tiles || token !== this.generation) return undefined;
    this.generation++;
    return this.show(tiles, now);
  }

  /** The last tiles again, once a hold has run out. Not new data, so no new generation. */
  expire(now: number): AgentsView {
    return this.show(this.last, now);
  }

  private show(tiles: readonly AgentTile[], now: number): AgentsView {
    this.last = tiles;
    const held = this.hold.apply(tiles, now);
    const count = runningAgents(held.tiles);
    return held.nextExpiry === undefined ? { count } : { count, nextExpiry: held.nextExpiry };
  }
}
