/**
 * (De)serialization for installed expert persona files under `docs/agents/`.
 *
 * Pure string helpers (no Theia/node imports) so they are unit-testable and
 * usable from the browser bundle. The file format is a markdown document with
 * an `id/name/icon/color[/model]` frontmatter block followed by the system
 * prompt body.
 */

/** Fields needed to write a persona file. */
export interface ExpertFileFields {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly systemPrompt: string;
  readonly model?: string;
}

/** Frontmatter metadata read back for the panel (body not included). */
export interface InstalledExpertMeta {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly model?: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const FIELD_RE = /^(id|name|icon|color|model):\s*(.+)$/;

/** Serialize a persona into the `docs/agents/<id>.md` file format. */
export function serializeExpertFile(e: ExpertFileFields): string {
  const lines = ["---", `id: ${e.id}`, `name: ${e.name}`, `icon: ${e.icon}`, `color: ${e.color}`];
  if (e.model) lines.push(`model: ${e.model}`);
  lines.push("---", "", e.systemPrompt.trim(), "");
  return lines.join("\n");
}

/**
 * Parse the frontmatter of a persona file.
 *
 * Returns `undefined` when there is no frontmatter or no usable id/name, so the
 * caller can skip malformed files without crashing the panel.
 *
 * @param markdown    Raw file content.
 * @param idFallback  Used when the frontmatter omits `id` (e.g. derived from filename).
 */
export function parseExpertFrontmatter(
  markdown: string,
  idFallback: string,
): InstalledExpertMeta | undefined {
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) return undefined;
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const m = line.match(FIELD_RE);
    if (m && m[1] && m[2]) fields[m[1]] = m[2].trim();
  }
  const id = fields["id"] ?? idFallback;
  const name = fields["name"];
  if (!id || !name) return undefined;
  return {
    id,
    name,
    icon: fields["icon"] ?? "codicon-person",
    color: fields["color"] ?? "#888888",
    ...(fields["model"] ? { model: fields["model"] } : {}),
  };
}

/** An installed expert and the workspace folders (labels) that have it. */
export interface InstalledExpert extends InstalledExpertMeta {
  readonly folders: readonly string[];
}

/**
 * Merge the experts found in each workspace folder into one list, one entry
 * per expert id, remembering which folders have it. The first folder's
 * metadata wins when two folders disagree. Sorted by name.
 */
export function mergeInstalled(
  perFolder: readonly { readonly folder: string; readonly experts: readonly InstalledExpertMeta[] }[],
): InstalledExpert[] {
  const byId = new Map<string, InstalledExpert>();
  for (const { folder, experts } of perFolder) {
    for (const e of experts) {
      const seen = byId.get(e.id);
      byId.set(e.id, seen ? { ...seen, folders: [...seen.folders, folder] } : { ...e, folders: [folder] });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
