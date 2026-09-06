#!/usr/bin/env bash
# Usage: bash scripts/release.sh [patch|minor|major]
# Default bump: patch
# What it does:
#   1. Validates git state (clean working tree, on main)
#   2. Bumps version in apps/desktop/package.json + package.json
#   3. Generates changelog section from commits since last tag
#   4. Prepends section to CHANGELOG.md
#   5. Commits + tags v<new-version>
#   6. Pushes commit + tag  →  GitHub Actions release.yml fires

set -euo pipefail

BUMP="${1:-patch}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Validation ────────────────────────────────────────────────────────────────

cd "$REPO_ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty. Commit or stash changes first." >&2
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "error: must be on main, currently on '$CURRENT_BRANCH'." >&2
  exit 1
fi

# ── Version bump (pure bash semver) ──────────────────────────────────────────

CURRENT_VERSION="$(node -p "require('./apps/desktop/package.json').version")"
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
  *)
    echo "error: bump must be patch, minor, or major (got '$BUMP')." >&2
    exit 1
    ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
TAG="v${NEW_VERSION}"

echo "Bumping ${CURRENT_VERSION} → ${NEW_VERSION} (${BUMP})"

# Update version fields using node to avoid platform differences with jq/sed
node -e "
const fs = require('fs');
function bump(file) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.version = '${NEW_VERSION}';
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}
bump('package.json');
bump('apps/desktop/package.json');
"

# ── Changelog ─────────────────────────────────────────────────────────────────

LAST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || echo "")"
DATE="$(date +%Y-%m-%d)"

if [[ -n "$LAST_TAG" ]]; then
  RANGE="${LAST_TAG}..HEAD"
else
  RANGE="HEAD"
fi

# Collect commits: skip chore/release/merge commits for readability
COMMITS="$(git log "$RANGE" --pretty=format:"%s" \
  --no-merges \
  | grep -v "^chore: release\|^Merge " \
  || true)"

[[ -z "$COMMITS" ]] && COMMITS="Minor improvements and bug fixes."

# ── AI-generated ironic changelog via claude CLI ──────────────────────────────
# One call → JSON { tagline, entries } → CHANGELOG.md, the only source the
# in-app "What's new" panel reads (fetched from GitHub at the release tag).
# Falls back to raw commits if claude is unavailable or returns unparseable output.

TMPJSON="$(mktemp)"
trap 'rm -f "$TMPJSON"' EXIT

TAGLINE="A new version is available."
CHANGELOG_BODY=""
ENTRIES_JSON='[]'

if command -v claude &>/dev/null; then
  echo "Generating changelog via Claude…"

  CLAUDE_PROMPT="Generate release notes for v${NEW_VERSION} released on ${DATE}.

Commits to describe:
${COMMITS}

Output ONLY a valid JSON object — no preamble, no explanation, no code fence:
{
  \"tagline\": \"<ironic one-liner under 8 words that sums up the release>\",
  \"entries\": [\"<entry1>\", \"<entry2>\", ...]
}

Rules for entries:
- English, dry ironic tone: a developer who has seen too many retrospectives and not enough green CI runs.
- Each entry is one sentence, max 25 words.
- Wrap every technical term in a markdown link (MDN for browser/web APIs; tool GitHub/docs for frameworks/CLIs; Wikipedia for architectural concepts).
- Start with active verb or noun — never 'we added' or 'this version includes'.
- Most user-visible changes first; internals last.
- When 5+ entries, interleave heading strings (\"### Features\", \"### Fixes\", \"### Internals\") in the array before each group."

  printf '%s' "$CLAUDE_PROMPT" | claude --print > "$TMPJSON" 2>/dev/null || true

  PARSE_OK="$(node -e "
    const fs = require('fs');
    let raw = '';
    try { raw = fs.readFileSync(process.argv[1], 'utf8').trim(); } catch (e) {}
    // claude --print sometimes wraps JSON in a markdown code fence despite
    // being told not to — strip it before parsing rather than trusting the
    // model to always comply.
    raw = raw.replace(/^\`\`\`(?:json)?\s*/, '').replace(/\s*\`\`\`\$/, '').trim();
    try {
      const obj = JSON.parse(raw);
      if (typeof obj.tagline !== 'string' || !Array.isArray(obj.entries) || obj.entries.length === 0) {
        throw new Error('bad shape');
      }
      fs.writeFileSync(process.argv[1], JSON.stringify(obj));
      process.stdout.write('OK');
    } catch (e) {
      process.stdout.write('FAIL');
    }
  " "$TMPJSON" 2>/dev/null || echo "FAIL")"

  if [[ "$PARSE_OK" == "OK" ]]; then
    TAGLINE="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).tagline)" \
      "$TMPJSON" 2>/dev/null || echo "")"
    ENTRIES_JSON="$(node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).entries))" \
      "$TMPJSON" 2>/dev/null || echo "[]")"
    CHANGELOG_BODY="$(node -e "
      const arr = JSON.parse(process.argv[1]);
      const lines = arr.map(function(s){ return /^###/.test(s) ? '\n' + s : '- ' + s; });
      process.stdout.write(lines.join('\n').replace(/^\n/, ''));
    " "$ENTRIES_JSON" 2>/dev/null || echo "")"
  else
    echo "Claude output parse failed, falling back to raw commits."
  fi
fi

if [[ -z "$CHANGELOG_BODY" ]]; then
  CHANGELOG_BODY="$(printf '%s\n' "$COMMITS" | sed 's/^/- /')"
fi

# The tagline must stay on a single line: the in-app panel reads it as one
# blockquote, and a stray newline would leave the release with no title.
TAGLINE="$(printf '%s' "$TAGLINE" | tr '\n' ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
[[ -z "$TAGLINE" ]] && TAGLINE="A new version is available."

# The `> tagline` line is part of the contract: the in-app "What's new" panel
# parses it straight out of CHANGELOG.md.
CHANGELOG_SECTION="## ${NEW_VERSION} — ${DATE}

> ${TAGLINE}

${CHANGELOG_BODY}
"

CHANGELOG_FILE="${REPO_ROOT}/CHANGELOG.md"

if [[ -f "$CHANGELOG_FILE" ]]; then
  # Prepend new section after the title line
  EXISTING="$(tail -n +2 "$CHANGELOG_FILE")"
  TITLE="$(head -1 "$CHANGELOG_FILE")"
  printf '%s\n\n%s\n%s\n' "$TITLE" "$CHANGELOG_SECTION" "$EXISTING" > "$CHANGELOG_FILE"
else
  printf '# Changelog\n\n%s\n' "$CHANGELOG_SECTION" > "$CHANGELOG_FILE"
fi

echo "Changelog updated."

# ── Commit, tag, push ─────────────────────────────────────────────────────────

git add package.json apps/desktop/package.json CHANGELOG.md
git commit -m "chore: release ${TAG}"

git tag -a "$TAG" -m "Release ${TAG}"

echo "Pushing ${TAG} → origin (this triggers the GitHub Actions release)…"
git push origin main
git push origin "$TAG"

echo ""
echo "Done. GitHub Actions release.yml will build installers and publish the release."
echo "Track progress: https://github.com/marcellobarile/spexr-ide/actions"
