import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ToolCounter, countSessions, syncToolCounts } from "./tool-count.js";

const dir = mkdtempSync(join(tmpdir(), "spexr-toolcount-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const use = (id: string): string => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Read", input: {} }] } });
const two = (a: string, b: string): string => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: a, name: "Read" }, { type: "text", text: "x" }, { type: "tool_use", id: b, name: "Bash" }] } });
const text = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: 'a result quoting {"type":"tool_use"} as text' }] } });

let n = 0;
const file = (content: string): string => {
  const path = join(dir, `t${n++}.jsonl`);
  writeFileSync(path, content);
  return path;
};

describe("ToolCounter", () => {
  it("counts the tool_use blocks, several to a line, and not a quotation of one in a result", async () => {
    const path = file([use("a"), two("b", "c"), text, ""].join("\n"));
    expect(await new ToolCounter().count(path)).toBe(3);
  });

  it("reads only what the file gained, and keeps its count", async () => {
    const path = file(use("a") + "\n");
    const c = new ToolCounter();
    expect(await c.count(path)).toBe(1);
    expect(c.cached(path)).toBe(1);
    appendFileSync(path, two("b", "c") + "\n");
    expect(await c.count(path)).toBe(3);
    expect(await c.count(path)).toBe(3);
  });

  it("does not count a line still being written, and counts it once, not twice, when it is whole", async () => {
    const path = file(use("a") + "\n");
    const c = new ToolCounter();
    const line = two("b", "c");
    appendFileSync(path, line.slice(0, 40));
    expect(await c.count(path)).toBe(1);
    appendFileSync(path, line.slice(40, 70));
    expect(await c.count(path)).toBe(1);
    appendFileSync(path, line.slice(70) + "\n");
    expect(await c.count(path)).toBe(3);
    expect(await c.count(path)).toBe(3);
  });

  it("is not fooled by a cut that falls inside the pattern", async () => {
    const path = file("");
    const c = new ToolCounter();
    const line = use("a");
    const cut = line.indexOf('"type":"tool_use"') + 7;
    appendFileSync(path, line.slice(0, cut));
    expect(await c.count(path)).toBe(0);
    appendFileSync(path, line.slice(cut) + "\n");
    expect(await c.count(path)).toBe(1);
  });

  it("counts across the scan's read size on a large file", async () => {
    const lines = Array.from({ length: 6000 }, (_, i) => use(`t${i}`) + "x".repeat(300));
    // ~2 MB: more than one 1 MiB read, with a line straddling the boundary.
    const path = file(lines.join("\n") + "\n");
    expect(await new ToolCounter().count(path)).toBe(6000);
  });

  it("starts over when the file shrank", async () => {
    const path = file(two("a", "b") + "\n" + two("c", "d") + "\n");
    const c = new ToolCounter();
    expect(await c.count(path)).toBe(4);
    writeFileSync(path, use("z") + "\n");
    expect(await c.count(path)).toBe(1);
  });

  it("answers undefined for a file that is not there, and forgets it", async () => {
    const c = new ToolCounter();
    const path = file(use("a") + "\n");
    await c.count(path);
    rmSync(path);
    expect(await c.count(path)).toBeUndefined();
    expect(c.cached(path)).toBeUndefined();
    expect(await c.count(join(dir, "never"))).toBeUndefined();
  });

  it("counts an empty file as 0", async () => {
    expect(await new ToolCounter().count(file(""))).toBe(0);
  });
});

describe("countSessions and syncToolCounts", () => {
  it("say whether anything moved, and sync forgets sessions that are gone", async () => {
    const a = file(use("a") + "\n");
    const b = file(use("b") + "\n");
    const c = new ToolCounter();
    expect(await countSessions(c, [{ transcriptPath: a }, { transcriptPath: b }, { transcriptPath: "" }])).toBe(true);
    expect(await countSessions(c, [{ transcriptPath: a }, { transcriptPath: b }])).toBe(false);
    appendFileSync(b, use("c") + "\n");
    expect(await syncToolCounts(c, [{ transcriptPath: b }])).toBe(true);
    expect(c.cached(b)).toBe(2);
    expect(c.cached(a)).toBeUndefined();
  });
});

describe("ToolCounter, review regressions", () => {
  it("starts over when the file was replaced by a larger one, not only a smaller", async () => {
    const path = file(use("a") + "\n");
    const c = new ToolCounter();
    expect(await c.count(path)).toBe(1);
    // A new file at the same path: a different inode, and bigger than the old offset.
    rmSync(path);
    writeFileSync(path, [two("b", "c"), two("d", "e"), two("f", "g")].join("\n") + "\n");
    expect(await c.count(path)).toBe(6);
  });

  it("skips a line past the limit instead of holding it, and counts what follows", async () => {
    const huge = "x".repeat(33 << 20);
    const path = file(use("a") + "\n" + huge + "\n" + two("b", "c") + "\n");
    expect(await new ToolCounter().count(path)).toBe(3);
  });
});
