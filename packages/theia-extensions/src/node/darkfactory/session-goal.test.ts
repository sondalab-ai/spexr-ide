import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFirstPrompt } from "./session-goal.js";

const dirs: string[] = [];

async function transcript(lines: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "spexr-goal-"));
  dirs.push(dir);
  const path = join(dir, "s.jsonl");
  await writeFile(path, lines.join("\n"), "utf8");
  return path;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("readFirstPrompt", () => {
  it("finds the prompt past an injected preamble larger than the wall's window", async () => {
    const filler = "F".repeat(40_000);
    const path = await transcript([
      JSON.stringify({ isMeta: true, message: { role: "user", content: "Caveat: injected" } }),
      JSON.stringify({ message: { role: "user", content: `<system-reminder>${filler}</system-reminder>` } }),
      JSON.stringify({ message: { role: "user", content: "add new effects to the design system" } }),
    ]);
    expect(await readFirstPrompt(path)).toBe("add new effects to the design system");
  });

  it("skips tool results and meta entries", async () => {
    const path = await transcript([
      JSON.stringify({ message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } }),
      JSON.stringify({ isMeta: true, message: { role: "user", content: "Caveat: injected" } }),
      JSON.stringify({ message: { role: "user", content: [{ type: "text", text: "fix the git panel" }] } }),
    ]);
    expect(await readFirstPrompt(path)).toBe("fix the git panel");
  });

  it("returns empty for a missing file or a transcript with no genuine prompt", async () => {
    expect(await readFirstPrompt("/nope/missing.jsonl")).toBe("");
    const path = await transcript([JSON.stringify({ message: { role: "assistant", content: "hi" } })]);
    expect(await readFirstPrompt(path)).toBe("");
  });

  it("ignores a prompt that straddles the read cut rather than half-reading it", async () => {
    const path = await transcript([
      JSON.stringify({ message: { role: "user", content: "A".repeat(500) } }),
      JSON.stringify({ message: { role: "user", content: "second prompt" } }),
    ]);
    expect(await readFirstPrompt(path, 100)).toBe("");
  });
});
