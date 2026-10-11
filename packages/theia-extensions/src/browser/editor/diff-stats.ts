import { DiffComputer } from "@theia/scm/lib/browser/dirty-diff/diff-computer";
import { ContentLines } from "@theia/scm/lib/browser/dirty-diff/content-lines";
import { foldDiffStats, type DiffStats } from "./breadcrumb-model.js";

const computer = new DiffComputer();

/**
 * Lines added and removed going from `previous` to `current`: Theia's own
 * DirtyDiff computation (the one the gutter's bars use), folded with
 * {@link foldDiffStats}. Both sides are plain text, so the committed revision
 * and the editor's document feed it alike.
 */
export function diffStats(previous: string, current: string): DiffStats {
  const { changes } = computer.computeDirtyDiff(ContentLines.arrayLike(ContentLines.fromString(previous)), ContentLines.arrayLike(ContentLines.fromString(current)));
  return foldDiffStats(changes);
}
