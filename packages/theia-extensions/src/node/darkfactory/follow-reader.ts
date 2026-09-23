import { open } from "node:fs/promises";

/**
 * Where a read-only follow has read a transcript up to: the byte offset reached,
 * the bytes of a last line still missing its newline, and whether the reader is
 * still skipping the rest of a line a tail cut landed in.
 */
export interface FollowCursor {
  readonly offset: number;
  readonly pending: Buffer;
  readonly skipping?: boolean;
}

const NEWLINE = 0x0a;

/**
 * Read the complete lines a transcript gained since `cursor`, without re-reading
 * what came before. The first call (no cursor), or one on a file that shrank,
 * starts `tailBytes` from the end instead of at byte 0, so opening a follow on a
 * transcript of tens of MB does not decode and split the whole file on the
 * backend's only thread. Only whole lines come back; a partial one waits for
 * its newline in the returned cursor.
 */
export async function readFollowChunk(
  path: string,
  cursor: FollowCursor | undefined,
  tailBytes: number,
): Promise<{ lines: string[]; cursor: FollowCursor | undefined }> {
  let fh;
  try {
    fh = await open(path, "r");
  } catch {
    return { lines: [], cursor };
  }
  try {
    const { size } = await fh.stat();
    const restart = cursor === undefined || size < cursor.offset;
    const start = restart ? Math.max(0, size - tailBytes) : cursor.offset;
    const buf = Buffer.alloc(size - start);
    if (buf.length > 0) await fh.read(buf, 0, buf.length, start);
    let data = restart ? buf : Buffer.concat([cursor.pending, buf]);
    let skipping = restart ? start > 0 : cursor.skipping === true;
    if (skipping) {
      const firstNl = data.indexOf(NEWLINE);
      if (firstNl === -1) return { lines: [], cursor: { offset: size, pending: Buffer.alloc(0), skipping } };
      data = data.subarray(firstNl + 1);
      skipping = false;
    }
    const lastNl = data.lastIndexOf(NEWLINE);
    const complete = lastNl === -1 ? "" : data.subarray(0, lastNl).toString("utf8");
    const pending = Buffer.from(data.subarray(lastNl + 1));
    return {
      lines: complete.split("\n").filter((l) => l !== ""),
      cursor: { offset: size, pending },
    };
  } catch {
    return { lines: [], cursor };
  } finally {
    await fh.close();
  }
}
