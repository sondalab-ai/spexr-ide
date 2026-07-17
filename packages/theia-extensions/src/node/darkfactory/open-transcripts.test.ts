import { describe, expect, it } from "vitest";
import { parseLsofOutput, openTranscriptPaths } from "./open-transcripts.js";

const DIR = "/Users/x/.claude/projects";

describe("parseLsofOutput", () => {
  it("keeps only .jsonl paths under projectsDir", () => {
    const stdout = [
      `${DIR}/-proj/a.jsonl`,
      `/tmp/other.log`,
      `${DIR}/-proj/b.txt`,
      `${DIR}/-p2/c.jsonl`,
    ].join("\n");
    const set = parseLsofOutput(stdout, DIR);
    expect([...set].sort()).toEqual([`${DIR}/-p2/c.jsonl`, `${DIR}/-proj/a.jsonl`]);
  });
});

describe("openTranscriptPaths", () => {
  it("returns null when the runner throws", async () => {
    const set = await openTranscriptPaths(DIR, {
      run: () => Promise.reject(new Error("lsof: command not found")),
    });
    expect(set).toBeNull();
  });

  it("returns parsed set from runner stdout", async () => {
    const set = await openTranscriptPaths(DIR, {
      run: () => Promise.resolve(`${DIR}/-proj/a.jsonl\n`),
    });
    expect(set).toEqual(new Set([`${DIR}/-proj/a.jsonl`]));
  });
});
