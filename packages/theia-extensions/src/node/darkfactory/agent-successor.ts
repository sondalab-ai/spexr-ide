/**
 * A transcript in the followed session's project folder, as far as picking the
 * session that took over from the followed one needs to know it.
 */
export interface SuccessorCandidate {
  sessionId: string;
  mtimeMs: number;
  /** When the transcript's first message was written, epoch ms. */
  firstAtMs?: number;
  /** The transcript's first message uuid; a resume copy shares it with the original. */
  rootUuid?: string;
}

/**
 * The session the pane should follow instead of `current`, or undefined to
 * stay. Two ways a conversation moves to another transcript:
 *
 * - `/resume` writes the conversation, uuids included, to a new transcript:
 *   the lineage says `current` was taken over (`superseded`, from
 *   {@link SessionLineage.superseded}) and by which session.
 * - `/clear` starts a new session in the same folder, with nothing copied: the
 *   successor is the first transcript to begin after `current` last wrote,
 *   among those that do not share its conversation.
 *
 * A second Claude started in the same folder after the pane's session last
 * wrote looks the same as `/clear` and would be adopted: there is nothing in
 * the transcripts to tell them apart.
 */
export function chooseSuccessor(
  current: { sessionId: string; lastAtMs?: number; rootUuid?: string },
  superseded: ReadonlyMap<string, string>,
  candidates: readonly SuccessorCandidate[],
): string | undefined {
  const resumed = superseded.get(current.sessionId);
  if (resumed && resumed !== current.sessionId) return resumed;
  if (current.lastAtMs === undefined) return undefined;
  const later = candidates
    .filter(
      (c) =>
        c.sessionId !== current.sessionId &&
        c.firstAtMs !== undefined &&
        c.firstAtMs >= current.lastAtMs! &&
        (c.rootUuid === undefined || c.rootUuid !== current.rootUuid),
    )
    .sort((a, b) => a.firstAtMs! - b.firstAtMs!);
  return later[0]?.sessionId;
}
