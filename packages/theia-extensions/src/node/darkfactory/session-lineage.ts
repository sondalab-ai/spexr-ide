import { createReadStream } from "node:fs";

/**
 * What the wall knows about one transcript's place in a resume chain.
 *
 * Claude writes every resume to a new transcript with the conversation copied
 * in, message uuids included — so one conversation leaves a trail of copies,
 * each a snapshot of the one before. A copy made after a compaction starts at
 * the compaction point instead of the first message.
 */
export interface LineageNode {
  sessionId: string;
  transcriptPath: string;
  mtimeMs: number;
  /** Last message uuid: a newer copy that contains it continued from here. */
  tipUuid?: string;
}

/** A transcript's first message, which every copy of the same conversation shares. */
export interface LineageRoot {
  uuid: string;
  /** When the root line was written; the transcript was active from then on. */
  atMs?: number;
  /**
   * True when the transcript opens on a compaction: the original holds this
   * same boundary somewhere in its middle, not at its start.
   */
  compact: boolean;
}

interface LineageEntry {
  uuid?: unknown;
  parentUuid?: unknown;
  subtype?: unknown;
  timestamp?: unknown;
}

/** A transcript's lineage facts from the tail the scan already read. */
export function lineageNode(
  sessionId: string,
  transcriptPath: string,
  mtimeMs: number,
  entries: readonly unknown[],
): LineageNode {
  const node: LineageNode = { sessionId, transcriptPath, mtimeMs };
  for (const raw of entries) {
    const uuid = (raw as LineageEntry).uuid;
    if (typeof uuid === "string") node.tipUuid = uuid;
  }
  return node;
}

/** How far into a transcript its first message is looked for. */
const ROOT_SCAN_BYTES = 16 << 20;

/**
 * The first entry carrying a message uuid. Read on its own rather than from the
 * scan's bounded head: a transcript can open with a single attachment line
 * larger than that head, which then holds no message at all.
 */
export async function readRoot(path: string): Promise<LineageRoot | undefined> {
  let pending = "";
  let read = 0;
  try {
    for await (const chunk of createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 16 })) {
      read += (chunk as string).length;
      pending += chunk as string;
      let nl: number;
      while ((nl = pending.indexOf("\n")) !== -1) {
        const root = rootOf(pending.slice(0, nl));
        if (root) return root;
        pending = pending.slice(nl + 1);
      }
      if (read > ROOT_SCAN_BYTES) return undefined;
    }
  } catch {
    return undefined;
  }
  return rootOf(pending);
}

function rootOf(line: string): LineageRoot | undefined {
  if (!line.includes('"uuid"')) return undefined;
  let e: LineageEntry;
  try {
    e = JSON.parse(line) as LineageEntry;
  } catch {
    return undefined;
  }
  if (typeof e.uuid !== "string") return undefined;
  const ms = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
  return {
    uuid: e.uuid,
    ...(Number.isNaN(ms) ? {} : { atMs: ms }),
    compact: e.subtype === "compact_boundary" && e.parentUuid === null,
  };
}

/** True when the file holds `needle`; streamed, so a tens-of-MB transcript is never held whole. */
export async function fileContains(path: string, needle: string): Promise<boolean> {
  const target = Buffer.from(needle, "utf8");
  let carry = Buffer.alloc(0);
  try {
    for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
      const buf = Buffer.concat([carry, chunk as Buffer]);
      if (buf.indexOf(target) !== -1) return true;
      carry = buf.subarray(Math.max(0, buf.length - target.length + 1));
    }
  } catch {
    return false; // unreadable → no evidence of a link
  }
  return false;
}

/** How a transcript names a message uuid, so a uuid quoted in prose never matches. */
const uuidField = (uuid: string): string => `"uuid":"${uuid}"`;

/** A node with its root resolved. */
interface Rooted extends LineageNode {
  root: LineageRoot;
}

/**
 * Finds the transcripts a newer copy has taken over, so the wall shows each
 * conversation once. A transcript is superseded only when a newer one in its
 * lineage contains its last message: a fork whose two branches both moved on
 * keeps both.
 *
 * Whole-file searches run only inside lineages with more than one transcript,
 * and their answers are cached on the searched file's mtime.
 */
export class SessionLineage {
  /** Transcripts only grow at the end, so a file's root, once found, is read once. */
  private readonly roots = new Map<string, Promise<LineageRoot | undefined>>();
  private readonly searches = new Map<string, boolean>();
  /**
   * Superseded transcript version → the session found holding its tip. The
   * holder keeps growing, so its own mtime would miss every time; the copied
   * tip never leaves it, so the answer only lapses when the older one changes.
   */
  private readonly takenBy = new Map<string, string>();

  constructor(
    private readonly contains: (path: string, needle: string) => Promise<boolean> = fileContains,
    private readonly rootReader: (path: string) => Promise<LineageRoot | undefined> = readRoot,
  ) {}

  /**
   * Map each superseded session to the newest transcript that took it over,
   * following the chain to its end.
   */
  async superseded(nodes: readonly LineageNode[]): Promise<Map<string, string>> {
    const withFile = nodes.filter((n) => n.transcriptPath && n.tipUuid);
    const rooted: Rooted[] = [];
    for (const n of withFile) {
      const root = await this.rootOf(n.transcriptPath);
      if (root) rooted.push({ ...n, root });
    }
    const next = new Map<string, string>();
    for (const members of await this.group(rooted)) {
      if (members.length < 2) continue;
      const newestFirst = [...members].sort((a, b) => b.mtimeMs - a.mtimeMs);
      const ids = new Set(members.map((m) => m.sessionId));
      for (const older of newestFirst) {
        const key = versionKey(older);
        const known = this.takenBy.get(key);
        if (known && ids.has(known)) {
          next.set(older.sessionId, known);
          continue;
        }
        for (const newer of newestFirst) {
          if (newer.mtimeMs <= older.mtimeMs) break;
          if (await this.search(newer, older.tipUuid!)) {
            next.set(older.sessionId, newer.sessionId);
            this.takenBy.set(key, newer.sessionId);
            break;
          }
        }
      }
    }
    this.prune(withFile);
    return resolveChains(next);
  }

  private rootOf(path: string): Promise<LineageRoot | undefined> {
    let root = this.roots.get(path);
    if (!root) {
      root = this.rootReader(path);
      this.roots.set(path, root);
      // A transcript read while its first message is still being written has
      // no root yet; ask again next scan rather than never.
      void root.then((found) => {
        if (!found && this.roots.get(path) === root) this.roots.delete(path);
      });
    }
    return root;
  }

  /**
   * Lineages: plain resumes share a root uuid; a copy that opens on a compaction
   * joins the transcript that holds that boundary — found by searching only the
   * transcripts that were active when the compaction happened.
   */
  private async group(nodes: readonly Rooted[]): Promise<Rooted[][]> {
    const byRoot = new Map<string, Rooted[]>();
    for (const n of nodes) byRoot.set(n.root.uuid, [...(byRoot.get(n.root.uuid) ?? []), n]);
    const parent = new Map<string, string>([...byRoot.keys()].map((r) => [r, r]));
    const find = (r: string): string => {
      let at = r;
      while (parent.get(at) !== at) at = parent.get(at)!;
      return at;
    };
    for (const copy of nodes) {
      const at = copy.root.atMs;
      if (!copy.root.compact || at === undefined) continue;
      for (const original of nodes) {
        if (find(original.root.uuid) === find(copy.root.uuid)) continue;
        // Only an original older than the copy can be taken over by it, and an
        // older one is quiet, so its search is answered from the cache.
        if (original.mtimeMs >= copy.mtimeMs) continue;
        const from = original.root.atMs;
        if (from === undefined || from > at || original.mtimeMs < at) continue;
        if (await this.search(original, copy.root.uuid)) parent.set(find(copy.root.uuid), find(original.root.uuid));
      }
    }
    const groups = new Map<string, Rooted[]>();
    for (const [root, members] of byRoot) {
      const key = find(root);
      groups.set(key, [...(groups.get(key) ?? []), ...members]);
    }
    return [...groups.values()];
  }

  private async search(node: LineageNode, uuid: string): Promise<boolean> {
    const key = `${versionKey(node)}${uuid}`;
    const cached = this.searches.get(key);
    if (cached !== undefined) return cached;
    const found = await this.contains(node.transcriptPath, uuidField(uuid));
    this.searches.set(key, found);
    return found;
  }

  /** Forget answers about files and file versions no scan will ask about again. */
  private prune(nodes: readonly LineageNode[]): void {
    const current = new Set(nodes.map(versionKey));
    for (const key of this.searches.keys()) {
      if (!current.has(key.slice(0, key.lastIndexOf("\0") + 1))) this.searches.delete(key);
    }
    for (const key of this.takenBy.keys()) {
      if (!current.has(key)) this.takenBy.delete(key);
    }
    const paths = new Set(nodes.map((n) => n.transcriptPath));
    for (const path of this.roots.keys()) {
      if (!paths.has(path)) this.roots.delete(path);
    }
  }
}

/** One version of one transcript file: its path and mtime. */
function versionKey(node: LineageNode): string {
  return `${node.transcriptPath}\0${node.mtimeMs}\0`;
}

/** Point every superseded session at the end of its chain, not its next link. */
function resolveChains(next: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const from of next.keys()) {
    let to = next.get(from)!;
    const seen = new Set([from]);
    while (next.has(to) && !seen.has(to)) {
      seen.add(to);
      to = next.get(to)!;
    }
    out.set(from, to);
  }
  return out;
}
