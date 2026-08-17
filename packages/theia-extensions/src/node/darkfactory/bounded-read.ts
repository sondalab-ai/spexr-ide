import { open } from "node:fs/promises";

/** Bytes read from the head (goal/cwd/interactive markers) and tail (recent activity). */
const HEAD_BYTES = 32_768;
const TAIL_BYTES = 98_304;

/**
 * Stitch bounded head/tail reads back into whole JSON lines. When `truncated`,
 * the line straddling each cut is partial, so drop the head's last line and the
 * tail's first line; the middle of the transcript is intentionally skipped.
 */
export function stitchBoundedLines(head: string, tail: string, truncated: boolean): string[] {
  if (!truncated) return head.split("\n");
  const headLines = head.split("\n");
  headLines.pop();
  const tailLines = tail.split("\n");
  tailLines.shift();
  return [...headLines, ...tailLines];
}

/**
 * Read only the head and tail of a transcript (not the whole file — some run to
 * tens of MB). The head carries cwd/goal/interactive markers, the tail carries
 * recent activity; that is everything the wall and summary need.
 */
export async function readBoundedLines(path: string): Promise<string[]> {
  let fh;
  try {
    fh = await open(path, "r");
  } catch {
    return [];
  }
  try {
    const { size } = await fh.stat();
    if (size <= HEAD_BYTES + TAIL_BYTES) {
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, 0);
      return stitchBoundedLines(buf.toString("utf8"), "", false);
    }
    const headBuf = Buffer.alloc(HEAD_BYTES);
    await fh.read(headBuf, 0, HEAD_BYTES, 0);
    const tailBuf = Buffer.alloc(TAIL_BYTES);
    await fh.read(tailBuf, 0, TAIL_BYTES, size - TAIL_BYTES);
    return stitchBoundedLines(headBuf.toString("utf8"), tailBuf.toString("utf8"), true);
  } catch {
    return [];
  } finally {
    await fh.close();
  }
}
