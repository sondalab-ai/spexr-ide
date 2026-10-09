import { open } from "node:fs/promises";
import { forEachConcurrent } from "./concurrency.js";

/** What a transcript's scan has reached: the bytes read up to the last complete line, and the calls counted in them. */
interface Scanned {
  offset: number;
  count: number;
}

/** Bytes read per step; a long line is carried across steps, never cut. */
const CHUNK_BYTES = 1 << 20;
const NEWLINE = 0x0a;
/**
 * How a tool call is written in Claude Code's compact JSONL. Inside a string
 * the quotes are escaped (`\"type\":\"tool_use\"`), so the text of a tool
 * result that quotes a call cannot match.
 */
const TOOL_USE = Buffer.from('"type":"tool_use"');

/** Occurrences of the pattern in `buf`, not overlapping. */
function occurrences(buf: Buffer): number {
  let n = 0;
  for (let at = buf.indexOf(TOOL_USE); at !== -1; at = buf.indexOf(TOOL_USE, at + TOOL_USE.length)) n++;
  return n;
}

/**
 * The exact number of tool calls in a transcript, by an incremental byte scan:
 * each call to {@link count} reads only what the file gained since the last,
 * counting complete lines only, so a line still being written is counted once
 * its newline arrives and never twice. The scan is cached by path and offset;
 * a file that shrank (rewritten, or replaced by another) starts over.
 *
 * A line holds a call's `tool_use` block once, so the count is of calls, not
 * of lines. Resume copies carry the conversation they continue, calls included.
 */
export class ToolCounter {
  private readonly scanned = new Map<string, Scanned>();

  /** The count as of the last scan; undefined for a path never scanned. */
  cached(path: string): number | undefined {
    return this.scanned.get(path)?.count;
  }

  /** Scan what the file gained and return its call count; undefined when it cannot be read. */
  async count(path: string): Promise<number | undefined> {
    let fh;
    try {
      fh = await open(path, "r");
    } catch {
      this.scanned.delete(path);
      return undefined;
    }
    try {
      const { size } = await fh.stat();
      let state = this.scanned.get(path);
      if (!state || size < state.offset) state = { offset: 0, count: 0 };
      let carry = Buffer.alloc(0);
      let at = state.offset;
      let count = state.count;
      let done = state.offset;
      while (at < size) {
        const buf = Buffer.alloc(Math.min(CHUNK_BYTES, size - at));
        const { bytesRead } = await fh.read(buf, 0, buf.length, at);
        if (bytesRead === 0) break;
        at += bytesRead;
        const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
        const lastNl = data.lastIndexOf(NEWLINE);
        if (lastNl === -1) {
          carry = Buffer.from(data);
          continue;
        }
        count += occurrences(data.subarray(0, lastNl + 1));
        done = at - (data.length - (lastNl + 1));
        carry = Buffer.from(data.subarray(lastNl + 1));
      }
      this.scanned.set(path, { offset: done, count });
      return count;
    } catch {
      return this.scanned.get(path)?.count;
    } finally {
      await fh.close();
    }
  }

  /** Forget every path not in `keep`, so the cache follows the sessions that exist. */
  retain(keep: ReadonlySet<string>): void {
    for (const path of this.scanned.keys()) if (!keep.has(path)) this.scanned.delete(path);
  }
}

/** Transcripts scanned at once; each scan is a few reads. */
const COUNT_CONCURRENCY = 4;

/**
 * Bring the counter up to date with these sessions' transcript files. True
 * when any count changed, which is the caller's cue to hand the wall fresh
 * tiles.
 */
export async function countSessions(counter: ToolCounter, sessions: ReadonlyArray<{ transcriptPath: string }>): Promise<boolean> {
  const paths = sessions.map((s) => s.transcriptPath).filter(Boolean);
  let changed = false;
  await forEachConcurrent(paths, COUNT_CONCURRENCY, async (path) => {
    const before = counter.cached(path);
    const after = await counter.count(path);
    if (after !== before) changed = true;
  });
  return changed;
}

/** {@link countSessions} over every session that exists, then forget the paths that are gone. */
export async function syncToolCounts(counter: ToolCounter, sessions: ReadonlyArray<{ transcriptPath: string }>): Promise<boolean> {
  const changed = await countSessions(counter, sessions);
  counter.retain(new Set(sessions.map((s) => s.transcriptPath).filter(Boolean)));
  return changed;
}
