/**
 * Parser for the repository CHANGELOG.md, shared by the frontend "What's new"
 * panel. Kept node-free so the browser bundle can import it.
 *
 * Expected shape (newest release first):
 *
 *   ## 0.1.5 — 2026-07-02
 *   > tagline
 *   ### Features
 *   - a change
 *
 * Section headings (`### Features`, `### Fixes`, …) carry no meaning here: all
 * bullets of a release are flattened into a single list.
 */

export interface ReleaseNote {
  readonly version: string;
  readonly date: string;
  readonly tagline?: string;
  readonly changes: readonly string[];
}

const HEADING_RE = /^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})/;
const TAGLINE_RE = /^>\s+(.+)/;
const BULLET_RE = /^- (.+)/;
const BOLD_RE = /\*\*([^*]+)\*\*/g;

interface MutableNote {
  version: string;
  date: string;
  tagline?: string;
  changes: string[];
}

/**
 * Turns changelog markdown into release notes, preserving file order (newest
 * first). Anything before the first version heading is ignored.
 */
export function parseChangelog(markdown: string): readonly ReleaseNote[] {
  const entries: MutableNote[] = [];
  let current: MutableNote | undefined;

  for (const line of markdown.split("\n")) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      current = { version: heading[1]!, date: heading[2]!, changes: [] };
      entries.push(current);
      continue;
    }
    if (!current) continue;

    const tagline = TAGLINE_RE.exec(line);
    if (tagline && current.tagline === undefined) {
      current.tagline = tagline[1]!.trim();
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    // Bold markers are dropped; inline links are rendered by the panel itself.
    if (bullet) current.changes.push(bullet[1]!.replace(BOLD_RE, "$1"));
  }

  return entries;
}
