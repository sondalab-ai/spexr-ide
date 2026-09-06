import { parseChangelog, type ReleaseNote } from "../common/changelog.js";

const RAW_BASE = "https://raw.githubusercontent.com/sondalab-ai/spexr-ide";
/** Used when the installed version has no matching tag (dev builds, unreleased versions). */
const FALLBACK_REF = "main";
const FETCH_TIMEOUT_MS = 5000;
/** Guards the ref segment of the URL: only plain `major.minor.patch` becomes a tag. */
const VERSION_RE = /^\d+\.\d+\.\d+$/;

export function changelogUrl(ref: string): string {
  return `${RAW_BASE}/${ref}/CHANGELOG.md`;
}

/** Refs to try, in order: the tag of the running build, then the default branch. */
function refsFor(version: string | undefined): readonly string[] {
  return version !== undefined && VERSION_RE.test(version)
    ? [`v${version}`, FALLBACK_REF]
    : [FALLBACK_REF];
}

async function fetchChangelog(ref: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(changelogUrl(ref), { signal: controller.signal });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads the changelog from GitHub for the running version, falling back to the
 * default branch when that tag does not exist. Returns nothing when the network
 * is unavailable — the caller hides the panel rather than showing stale notes.
 */
export async function fetchReleaseNotes(version?: string): Promise<readonly ReleaseNote[]> {
  for (const ref of refsFor(version)) {
    const markdown = await fetchChangelog(ref);
    if (markdown !== undefined) return parseChangelog(markdown);
  }
  return [];
}
