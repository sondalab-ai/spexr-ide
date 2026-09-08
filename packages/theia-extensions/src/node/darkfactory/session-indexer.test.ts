import { describe, expect, it, vi } from "vitest";
import { SessionIndex } from "./session-index.js";
import { runSessionIndex, type IndexableSession } from "./session-indexer.js";

function session(id: string, mtimeMs: number, goal: string): IndexableSession {
  return {
    sessionId: id,
    harness: "claude",
    projectPath: `/p/${id}`,
    transcriptPath: `/t/${id}.jsonl`,
    configDir: "/c",
    mtimeMs,
    loadEntries: async () => [
      { message: { role: "user", content: goal } },
      { message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
    ],
  };
}

/** Embeds to a vector derived from the document length, enough to tell docs apart. */
const embed = async (texts: string[]): Promise<Float32Array[]> =>
  texts.map((t) => Float32Array.from([t.length, 1]));

describe("runSessionIndex", () => {
  it("indexes every listed session and persists once at the end", async () => {
    const index = new SessionIndex();
    const save = vi.fn(async () => {});
    await runSessionIndex({
      index,
      embed,
      list: async () => [session("a", 1, "add effects"), session("b", 2, "fix git")],
      save,
    });
    expect(index.size).toBe(2);
    expect(index.get("a")!.goal).toBe("add effects");
    expect(index.get("a")!.projectName).toBe("a");
    expect(save).toHaveBeenCalled();
  });

  it("skips sessions whose mtime has not changed", async () => {
    const index = new SessionIndex();
    const load = vi.fn(session("a", 1, "add effects").loadEntries);
    const first = { ...session("a", 1, "add effects"), loadEntries: load };
    await runSessionIndex({ index, embed, list: async () => [first], save: async () => {} });
    await runSessionIndex({ index, embed, list: async () => [first], save: async () => {} });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("re-indexes a session whose mtime moved", async () => {
    const index = new SessionIndex();
    await runSessionIndex({
      index,
      embed,
      list: async () => [session("a", 1, "old goal")],
      save: async () => {},
    });
    await runSessionIndex({
      index,
      embed,
      list: async () => [session("a", 2, "new goal")],
      save: async () => {},
    });
    expect(index.get("a")!.goal).toBe("new goal");
    expect(index.size).toBe(1);
  });

  it("drops sessions that vanished from enumeration", async () => {
    const index = new SessionIndex();
    await runSessionIndex({
      index,
      embed,
      list: async () => [session("a", 1, "x"), session("b", 1, "y")],
      save: async () => {},
    });
    await runSessionIndex({
      index,
      embed,
      list: async () => [session("a", 1, "x")],
      save: async () => {},
    });
    expect(index.ids()).toEqual(["a"]);
  });

  it("keeps the stored vector when a touched transcript still reads the same", async () => {
    const index = new SessionIndex();
    const embedSpy = vi.fn(embed);
    await runSessionIndex({
      index,
      embed: embedSpy,
      list: async () => [session("a", 1, "same goal")],
      save: async () => {},
    });
    await runSessionIndex({
      index,
      embed: embedSpy,
      list: async () => [session("a", 2, "same goal")],
      save: async () => {},
    });
    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(index.get("a")!.mtimeMs).toBe(2);
  });

  it("reports progress, ending at done === total", async () => {
    const progress: Array<[number, number]> = [];
    await runSessionIndex({
      index: new SessionIndex(),
      embed,
      list: async () => [session("a", 1, "x"), session("b", 1, "y")],
      save: async () => {},
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress.at(-1)).toEqual([2, 2]);
  });

  it("skips a session whose entries cannot be read, without failing the crawl", async () => {
    const index = new SessionIndex();
    const broken: IndexableSession = {
      ...session("bad", 1, "x"),
      loadEntries: async () => {
        throw new Error("unreadable");
      },
    };
    await runSessionIndex({
      index,
      embed,
      list: async () => [broken, session("ok", 1, "y")],
      save: async () => {},
    });
    expect(index.ids()).toEqual(["ok"]);
  });
});
