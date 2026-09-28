import { AUTO_APPROVE_MODES, isInterruptMarker, type StateEntry, type Turn } from "../darkfactory/session-state.js";

export type TurnSignal = { type: "turn-ended" } | { type: "needs-you" } | { type: "resumed-working" };

/**
 * Turns a stream of turn readings into the transitions the schedule acts on.
 * A turn end counts only after the agent was seen working since the last one:
 * right after a paste the transcript still ends with the previous reply.
 * `settleMs` is how long a pending permission tool must sit before it counts
 * as a prompt (0 when the source already confirmed it, as the wall's tiles do).
 */
export class TurnTracker {
  private armed: boolean;
  private blocked = false;
  private permissionSince: number | undefined;

  /** `armed`: true for a brand-new session, whose first reading is its own first turn. */
  constructor(private readonly o: { permissionMode?: string; settleMs: number; armed?: boolean }) {
    this.armed = o.armed ?? false;
  }

  update(reading: Turn, nowMs: number): TurnSignal[] {
    const turn = reading === "permission" && AUTO_APPROVE_MODES.has(this.o.permissionMode ?? "") ? "acting" : reading;
    const out: TurnSignal[] = [];
    if (turn !== "permission") this.permissionSince = undefined;
    if (turn === "acting") {
      this.armed = true;
      if (this.blocked) {
        this.blocked = false;
        out.push({ type: "resumed-working" });
      }
    } else if (turn === "permission") {
      this.armed = true;
      this.permissionSince ??= nowMs;
      if (!this.blocked && nowMs - this.permissionSince >= this.o.settleMs) {
        this.blocked = true;
        out.push({ type: "needs-you" });
      }
    } else if (turn === "ended") {
      if (this.blocked) {
        this.blocked = false;
        out.push({ type: "resumed-working" });
      }
      if (this.armed) {
        this.armed = false;
        out.push({ type: "turn-ended" });
      }
    }
    return out;
  }

  /**
   * Count the next ended reading as a turn end even if no work was seen
   * before it. Only a caller that knows a new prompt has arrived may call
   * this — the watchers do, once their prompt count has gone up after a paste.
   */
  arm(): void {
    this.armed = true;
  }
}

/** A genuine prompt: user text content, not the marker left when the human interrupts a turn. */
export function isPrompt(e: StateEntry): boolean {
  if (isInterruptMarker(e)) return false;
  if (e.isMeta || e.message?.role !== "user") return false;
  const c = e.message.content;
  if (typeof c === "string") return true;
  return Array.isArray(c) && c.some((b) => (b as { type?: string })?.type === "text");
}

/** Every assistant text block after the last genuine prompt, joined: the whole final reply. */
export function finalReply(entries: StateEntry[]): string {
  let start = entries.length - 1;
  while (start >= 0 && !isPrompt(entries[start]!)) start--;
  const texts: string[] = [];
  for (const e of entries.slice(start + 1)) {
    if (e.isMeta || e.message?.role !== "assistant" || !Array.isArray(e.message.content)) continue;
    for (const b of e.message.content as { type?: string; text?: string }[]) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) texts.push(b.text.trim());
    }
  }
  return texts.join("\n\n");
}
