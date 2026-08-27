import type { GitFileChangeDto, GitFileState } from "../../common/git-protocol.js";

/** A file decoration's letter, colour and tooltip, independent of Theia's `Decoration` type. */
export interface StateDecoration {
  readonly letter: string;
  readonly colorId: string;
  readonly tooltip: string;
}

// VS Code's own SCM decoration convention: "U" for untracked, "!" for
// conflicted — not the protocol's GitFileState letters, which keep "?" and
// "U" apart (see the comment on GitFileState in common/git-protocol.ts).
// Copied reuses the renamed colour; there is no distinct "copied" role in
// the gitDecoration.* palette. Deleted and conflicting also share one
// colour (gitDecoration.deletedResourceForeground and
// .conflictingResourceForeground both resolve to the same --sl-status-danger
// token in spexr-theme-contribution.ts) because the design system has four
// semantic status colours where this table needs five distinct ones; the
// letter ("D" vs "!") is what actually distinguishes the two states.
const DECORATION_BY_STATE: Record<GitFileState, StateDecoration> = {
  A: { letter: "A", colorId: "gitDecoration.addedResourceForeground", tooltip: "Added" },
  M: { letter: "M", colorId: "gitDecoration.modifiedResourceForeground", tooltip: "Modified" },
  D: { letter: "D", colorId: "gitDecoration.deletedResourceForeground", tooltip: "Deleted" },
  R: { letter: "R", colorId: "gitDecoration.renamedResourceForeground", tooltip: "Renamed" },
  C: { letter: "C", colorId: "gitDecoration.renamedResourceForeground", tooltip: "Copied" },
  U: { letter: "!", colorId: "gitDecoration.conflictingResourceForeground", tooltip: "Conflicted" },
  "?": { letter: "U", colorId: "gitDecoration.untrackedResourceForeground", tooltip: "Untracked" },
};

/**
 * The decoration for one changed file. A file with both a staged and an
 * unstaged state (edited again after staging) is one URI shared by two SCM
 * rows — the DecorationsService has no per-row concept, only per-URI — so
 * the unstaged (working-tree) state wins as the more "current" one; the
 * conflict state (reported only via unstagedState) always wins over both.
 */
export function decorationForFile(file: GitFileChangeDto): StateDecoration | undefined {
  const state = file.unstagedState ?? file.stagedState;
  return state ? DECORATION_BY_STATE[state] : undefined;
}
