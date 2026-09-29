import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fileContains,
  lineageNode,
  readRoot,
  SessionLineage,
  type LineageNode,
  type LineageRoot,
} from "./session-lineage.js";

/** One transcript line: a message with its uuid, as Claude writes it. */
const msg = (uuid: string, parentUuid: string | null, timestamp = "2026-09-28T10:00:00.000Z") => ({
  type: "user",
  uuid,
  parentUuid,
  timestamp,
  message: { role: "user", content: `turn ${uuid}` },
});

/** The first line of a copy resumed after a compaction. */
const boundary = (uuid: string, timestamp: string) => ({
  type: "system",
  subtype: "compact_boundary",
  uuid,
  parentUuid: null,
  logicalParentUuid: "before",
  timestamp,
});

/** A root reader answering from a fixed table, for nodes with no file behind them. */
const rootsOf = (table: Record<string, LineageRoot>) => async (path: string) => table[path];

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lineage-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Write a transcript and return its node, as a scan would build it. */
async function transcript(sessionId: string, mtimeMs: number, entries: object[]): Promise<LineageNode> {
  const path = join(dir, `${sessionId}.jsonl`);
  const lines = [{ type: "ai-title", aiTitle: "t", sessionId }, { type: "mode", mode: "normal" }, ...entries];
  await writeFile(path, lines.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return lineageNode(sessionId, path, mtimeMs, lines);
}

describe("lineageNode", () => {
  it("takes the tip from the last uuid entry", () => {
    const n = lineageNode("s", "/p", 1, [{ type: "ai-title" }, msg("a", null), msg("b", "a"), { type: "last-prompt" }]);
    expect(n.tipUuid).toBe("b");
  });
});

describe("readRoot", () => {
  it("finds the first message past an opening line larger than the scan's head read", async () => {
    const path = join(dir, "attached.jsonl");
    const attachment = { type: "attachment", content: "x".repeat(200_000) };
    await writeFile(path, [attachment, msg("r", null, "2026-09-28T10:00:00.000Z"), msg("r1", "r")].map((e) => JSON.stringify(e)).join("\n"));
    expect(await readRoot(path)).toEqual({ uuid: "r", atMs: Date.parse("2026-09-28T10:00:00.000Z"), compact: false });
  });

  it("marks a transcript that opens on a compaction", async () => {
    const node = await transcript("s", 1, [boundary("cb", "2026-09-28T10:23:02.442Z"), msg("c", "cb")]);
    expect(await readRoot(node.transcriptPath)).toEqual({
      uuid: "cb",
      atMs: Date.parse("2026-09-28T10:23:02.442Z"),
      compact: true,
    });
  });

  it("answers undefined for a file with no message", async () => {
    const path = join(dir, "meta.jsonl");
    await writeFile(path, JSON.stringify({ type: "ai-title" }));
    expect(await readRoot(path)).toBeUndefined();
    expect(await readRoot(join(dir, "gone.jsonl"))).toBeUndefined();
  });
});

describe("fileContains", () => {
  it("finds a needle that straddles two read chunks", async () => {
    const path = join(dir, "big.jsonl");
    const pad = "x".repeat((1 << 20) - 5);
    await writeFile(path, `${pad}"uuid":"needle"`);
    expect(await fileContains(path, `"uuid":"needle"`)).toBe(true);
    expect(await fileContains(path, `"uuid":"other"`)).toBe(false);
  });

  it("answers false for a missing file", async () => {
    expect(await fileContains(join(dir, "gone.jsonl"), "x")).toBe(false);
  });
});

describe("SessionLineage", () => {
  it("collapses a chain of plain resumes onto the newest copy", async () => {
    const a = await transcript("a", 100, [msg("r", null), msg("a1", "r")]);
    const b = await transcript("b", 200, [msg("r", null), msg("a1", "r"), msg("b1", "a1")]);
    const c = await transcript("c", 300, [msg("r", null), msg("a1", "r"), msg("b1", "a1"), msg("c1", "b1")]);
    const out = await new SessionLineage().superseded([a, b, c]);
    expect(out).toEqual(new Map([["a", "c"], ["b", "c"]]));
  });

  it("keeps both branches of a fork that each moved on", async () => {
    const a = await transcript("a", 300, [msg("r", null), msg("a1", "r"), msg("a2", "a1")]);
    const b = await transcript("b", 400, [msg("r", null), msg("a1", "r"), msg("b2", "a1")]);
    expect(await new SessionLineage().superseded([a, b])).toEqual(new Map());
  });

  it("does not let an older transcript supersede a newer one", async () => {
    const a = await transcript("a", 500, [msg("r", null), msg("a1", "r")]);
    const b = await transcript("b", 100, [msg("r", null), msg("a1", "r"), msg("b1", "a1")]);
    expect(await new SessionLineage().superseded([a, b])).toEqual(new Map([]));
  });

  it("joins a copy resumed after a compaction to the original that holds the boundary", async () => {
    const at = "2026-09-28T10:23:02.442Z";
    const original = await transcript("orig", Date.parse("2026-09-28T10:26:00.000Z"), [
      msg("r", null, "2026-09-28T09:00:00.000Z"),
      msg("o1", "r"),
      boundary("cb", at),
      msg("o2", "cb"),
    ]);
    const copy = await transcript("copy", Date.parse("2026-09-28T11:00:00.000Z"), [
      boundary("cb", at),
      msg("o2", "cb"),
      msg("c1", "o2"),
    ]);
    const unrelated = await transcript("other", Date.parse("2026-09-28T10:30:00.000Z"), [
      msg("x", null, "2026-09-28T08:00:00.000Z"),
      msg("x1", "x"),
    ]);
    const out = await new SessionLineage().superseded([original, copy, unrelated]);
    expect(out).toEqual(new Map([["orig", "copy"]]));
  });

  it("does not search a compaction original that was active after the copy", async () => {
    const contains = vi.fn(async () => true);
    const at = Date.parse("2026-09-28T10:23:00.000Z");
    const roots = rootsOf({ "/o": { uuid: "r", atMs: at - 1, compact: false }, "/c": { uuid: "cb", atMs: at, compact: true } });
    const original: LineageNode = { sessionId: "o", transcriptPath: "/o", mtimeMs: at + 10_000, tipUuid: "o9" };
    const copy: LineageNode = { sessionId: "c", transcriptPath: "/c", mtimeMs: at + 5_000, tipUuid: "c9" };
    expect(await new SessionLineage(contains, roots).superseded([original, copy])).toEqual(new Map());
    expect(contains).not.toHaveBeenCalled();
  });

  it("keeps a found takeover while the older transcript is unchanged, however the newer one grows", async () => {
    const contains = vi.fn(async () => true);
    const roots = vi.fn(async (): Promise<LineageRoot> => ({ uuid: "r", compact: false }));
    const lineage = new SessionLineage(contains, roots);
    const a: LineageNode = { sessionId: "a", transcriptPath: "/a", mtimeMs: 1, tipUuid: "a1" };
    const b = (mtimeMs: number): LineageNode => ({ sessionId: "b", transcriptPath: "/b", mtimeMs, tipUuid: `b${mtimeMs}` });
    expect(await lineage.superseded([a, b(2)])).toEqual(new Map([["a", "b"]]));
    expect(await lineage.superseded([a, b(3)])).toEqual(new Map([["a", "b"]]));
    expect(contains).toHaveBeenCalledTimes(1);
    expect(roots).toHaveBeenCalledTimes(2); // once per file, not per scan
  });

  it("reads a root again when the first read found none", async () => {
    let calls = 0;
    const roots = async (): Promise<LineageRoot | undefined> => (++calls === 1 ? undefined : { uuid: "r", compact: false });
    const lineage = new SessionLineage(async () => true, roots);
    const a: LineageNode = { sessionId: "a", transcriptPath: "/a", mtimeMs: 1, tipUuid: "a1" };
    const b: LineageNode = { sessionId: "b", transcriptPath: "/b", mtimeMs: 2, tipUuid: "b1" };
    expect(await lineage.superseded([a, b])).toEqual(new Map());
    expect(await lineage.superseded([a, b])).toEqual(new Map([["a", "b"]]));
  });

  it("ignores transcripts with no file, no message or no readable root", async () => {
    const contains = vi.fn(async () => true);
    const roots = rootsOf({ "/e": { uuid: "r", compact: false } });
    const out = await new SessionLineage(contains, roots).superseded([
      { sessionId: "oc", transcriptPath: "", mtimeMs: 1, tipUuid: "t" },
      { sessionId: "empty", transcriptPath: "/e", mtimeMs: 2 },
      { sessionId: "unreadable", transcriptPath: "/u", mtimeMs: 3, tipUuid: "u" },
      { sessionId: "sibling", transcriptPath: "/e2", mtimeMs: 4, tipUuid: "e" },
    ]);
    expect(out).toEqual(new Map());
    expect(contains).not.toHaveBeenCalled();
  });
});
