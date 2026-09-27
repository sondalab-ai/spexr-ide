import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_STARTUP_PROMPT_MS, findClaudeTranscript, watchClaudeTask, type WatchEvent } from "./claude-task-watcher.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function home(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "spexr-claude-watch-"));
  dirs.push(d);
  return d;
}

describe("findClaudeTranscript", () => {
  it("finds <id>.jsonl in any project folder of the account, default account included", async () => {
    const h = await home();
    await mkdir(join(h, ".claude", "projects", "-repo"), { recursive: true });
    await writeFile(join(h, ".claude", "projects", "-repo", "abc.jsonl"), "");
    expect(await findClaudeTranscript("", "abc", h)).toBe(join(h, ".claude", "projects", "-repo", "abc.jsonl"));
    expect(await findClaudeTranscript("~/.claude", "abc", h)).toBe(join(h, ".claude", "projects", "-repo", "abc.jsonl"));
    expect(await findClaudeTranscript("", "nope", h)).toBeUndefined();
  });
});

/** A manual clock and ticker: `tick()` runs one watcher iteration and waits for it. */
function harness(lines: () => string[] | undefined) {
  let now = 0;
  let tickFn: (() => Promise<void>) | undefined;
  const events: WatchEvent[] = [];
  const stop = watchClaudeTask(
    { sessionId: "abc", configDir: "" },
    {
      now: () => now,
      every: (fn) => {
        tickFn = fn;
        return () => (tickFn = undefined);
      },
      find: async () => (lines() ? "/t.jsonl" : undefined),
      read: async () => ({ lines: lines() ?? [], cursor: undefined }),
    },
    (e) => events.push(e),
  );
  return {
    events,
    stop,
    advance: async (ms: number) => {
      now += ms;
      await tickFn?.();
    },
    stopped: () => tickFn === undefined,
  };
}

const L = (o: unknown) => JSON.stringify(o);

describe("watchClaudeTask", () => {
  it("reports needs-you while no transcript exists (a startup dialog), once, and keeps waiting", async () => {
    let batch: string[] | undefined;
    const h = harness(() => batch);
    await h.advance(CLAUDE_STARTUP_PROMPT_MS - 1);
    expect(h.events).toEqual([]);
    await h.advance(2);
    expect(h.events).toEqual([{ type: "needs-you" }]);
    await h.advance(60_000);
    expect(h.events).toEqual([{ type: "needs-you" }]);
    expect(h.stopped()).toBe(false);
    batch = [L({ message: { role: "user", content: "p" } })];
    await h.advance(1_000);
    expect(h.events).toEqual([
      { type: "needs-you" },
      { type: "session-found", sessionId: "abc" },
      { type: "resumed-working" },
    ]);
  });

  it("reports the session, then a turn end with the whole reply", async () => {
    let batch: string[] | undefined;
    const h = harness(() => batch);
    batch = [L({ message: { role: "user", content: "p" } })];
    await h.advance(1_000);
    expect(h.events).toEqual([{ type: "session-found", sessionId: "abc" }]);
    batch = [L({ message: { role: "assistant", content: [{ type: "text", text: "done" }] } })];
    await h.advance(1_000);
    expect(h.events.at(-1)).toEqual({ type: "turn-ended", reply: "done" });
  });
});
