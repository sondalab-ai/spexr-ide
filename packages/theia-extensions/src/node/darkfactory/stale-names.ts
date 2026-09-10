/**
 * Which stored names no longer name anything. Both stores keep a name for as
 * long as the thing it names exists, and nothing ever removed one: a session
 * whose transcript the user deleted kept its name for the life of the machine.
 *
 * The decisions live here, apart from the filesystem, because the risk in this
 * feature is not the deletion itself — it is deleting a live name because a
 * scan came back short. That reasoning is what the tests need to reach.
 */

/**
 * Refuse the whole pass when it would drop more than this share of the stored
 * names at once. A user deletes sessions a few at a time; half the wall
 * disappearing at once is a scan that could not read a directory, and the
 * scanner reports that as an empty result rather than as an error.
 */
const MAX_DROP_SHARE = 0.5;

/**
 * …but never let the share alone veto a handful. Someone who has named two
 * sessions and deletes both is not a broken scan, and without this floor a
 * small store could never be swept at all: one name out of one is always the
 * whole file.
 */
const MIN_UNGUARDED_DROP = 2;

/**
 * Session names whose session is gone for good.
 *
 * Absence from one scan is not proof: a config dir that is briefly unreadable
 * is enumerated as nothing at all. A name is dropped only once its session has
 * been missing from two consecutive scans, and only when this pass would not
 * take out most of what is stored.
 *
 * @param names Stored `sessionId → name`.
 * @param enumerated Every session id the last full scan found.
 * @param missingBefore Ids that were already missing from the scan before it.
 * @returns The ids to drop, and the missing set to carry into the next pass.
 */
export function staleSessionNames(
  names: ReadonlyMap<string, string>,
  enumerated: ReadonlySet<string>,
  missingBefore: ReadonlySet<string>,
): { drop: string[]; missingNow: Set<string> } {
  const missingNow = new Set<string>();
  for (const id of names.keys()) if (!enumerated.has(id)) missingNow.add(id);

  // An empty scan means the walk found nothing at all — every name would look
  // stale, and none of it would be the user's doing.
  if (enumerated.size === 0) return { drop: [], missingNow };

  const drop = [...missingNow].filter((id) => missingBefore.has(id));
  if (!withinDropShare(drop.length, names.size)) return { drop: [], missingNow };
  return { drop, missingNow };
}

/**
 * Project names whose project is gone from disk.
 *
 * "No session left on the wall" is the wrong test: a project nobody has run an
 * agent in for a month is still a project, and its name should outlive the
 * sessions. What settles it is the directory — and only when its parent is
 * readable, so an unplugged volume reads as unreachable rather than as deleted.
 *
 * @param names Stored `projectPath → name`.
 * @param state Per path: whether the project directory and its parent exist.
 */
export function staleProjectNames(
  names: ReadonlyMap<string, string>,
  state: ReadonlyMap<string, { exists: boolean; parentExists: boolean }>,
): string[] {
  const drop = [...names.keys()].filter((path) => {
    const seen = state.get(path);
    return seen !== undefined && !seen.exists && seen.parentExists;
  });
  return withinDropShare(drop.length, names.size) ? drop : [];
}

/**
 * True when dropping `count` of `total` names is small enough to believe: a
 * handful either way, or no more than {@link MAX_DROP_SHARE} of the file.
 *
 * A sweep this refuses stays refused as long as the same names keep coming back
 * missing — someone who really did delete most of their sessions at once keeps
 * those names. Stale entries are the price of never dropping a live one, and
 * the file they sit in is a few kilobytes.
 */
function withinDropShare(count: number, total: number): boolean {
  if (count <= MIN_UNGUARDED_DROP || total === 0) return true;
  return count / total <= MAX_DROP_SHARE;
}
