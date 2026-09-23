import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFile, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFollowChunk, type FollowCursor } from "./follow-reader.js";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "follow-reader-"));
  file = join(dir, "t.jsonl");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readFollowChunk", () => {
  it("reads a small transcript whole on the first call", async () => {
    await writeFile(file, "a\nb\nc\n");
    const { lines } = await readFollowChunk(file, undefined, 1024);
    expect(lines).toEqual(["a", "b", "c"]);
  });

  it("starts a large transcript at its tail, dropping the line the cut splits", async () => {
    const body = Array.from({ length: 1000 }, (_, i) => `line-${i}`).join("\n") + "\n";
    await writeFile(file, body);
    const { lines } = await readFollowChunk(file, undefined, 64);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(10);
    expect(lines.at(-1)).toBe("line-999");
    for (const l of lines) expect(l).toMatch(/^line-\d+$/);
    expect(Number(lines[0]!.slice(5))).toBe(1000 - lines.length);
  });

  it("returns only what was appended since the previous call", async () => {
    await writeFile(file, "a\nb\n");
    const first = await readFollowChunk(file, undefined, 1024);
    await appendFile(file, "c\nd\n");
    const second = await readFollowChunk(file, first.cursor, 1024);
    expect(second.lines).toEqual(["c", "d"]);
    const third = await readFollowChunk(file, second.cursor, 1024);
    expect(third.lines).toEqual([]);
  });

  it("holds back a line still being written until its newline arrives", async () => {
    await writeFile(file, "a\n{\"half");
    const first = await readFollowChunk(file, undefined, 1024);
    expect(first.lines).toEqual(["a"]);
    await appendFile(file, "\":1}\n");
    const second = await readFollowChunk(file, first.cursor, 1024);
    expect(second.lines).toEqual(['{"half":1}']);
  });

  it("keeps a multi-byte character split across two appends intact", async () => {
    await writeFile(file, "x\n");
    const first = await readFollowChunk(file, undefined, 1024);
    const euro = Buffer.from("€\n");
    await appendFile(file, euro.subarray(0, 1));
    const mid = await readFollowChunk(file, first.cursor, 1024);
    expect(mid.lines).toEqual([]);
    await appendFile(file, euro.subarray(1));
    const last = await readFollowChunk(file, mid.cursor, 1024);
    expect(last.lines).toEqual(["€"]);
  });

  it("starts over at the tail when the file shrank under it", async () => {
    await writeFile(file, "a\nb\nc\n");
    const first = await readFollowChunk(file, undefined, 1024);
    await truncate(file, 0);
    await writeFile(file, "z\n");
    const second = await readFollowChunk(file, first.cursor, 1024);
    expect(second.lines).toEqual(["z"]);
  });

  it("yields nothing for a missing file and keeps the cursor", async () => {
    const cursor: FollowCursor = { offset: 3, pending: Buffer.alloc(0) };
    const { lines, cursor: next } = await readFollowChunk(join(dir, "nope"), cursor, 1024);
    expect(lines).toEqual([]);
    expect(next).toBe(cursor);
  });

  it("still starts at the tail once a file missing on the first call appears", async () => {
    const missing = await readFollowChunk(file, undefined, 4);
    expect(missing.cursor).toBeUndefined();
    await writeFile(file, "aaaa\nbb\n");
    const { lines } = await readFollowChunk(file, missing.cursor, 4);
    expect(lines).toEqual(["bb"]);
  });
});
