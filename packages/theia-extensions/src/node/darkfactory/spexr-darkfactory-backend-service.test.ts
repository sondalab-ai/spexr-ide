import { describe, expect, it, vi } from "vitest";
import type { FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  SpexrDarkfactoryBackendService,
  defaultOpencodeDataDir,
  forEachConcurrent,
} from "./spexr-darkfactory-backend-service.js";
import { stitchBoundedLines } from "./bounded-read.js";
import { claudeHarness } from "../../common/harness/claude-harness.js";
import type { SpexrDarkfactoryClient } from "../../common/darkfactory-protocol.js";

const NOW = 100 * 3_600_000;

function svc(over: Partial<ConstructorParameters<typeof SpexrDarkfactoryBackendService>[0]> = {}) {
  return new SpexrDarkfactoryBackendService({
    now: () => NOW,
    resumableConfigDir: "/Users/x/.claude",
    listTranscripts: () =>
      Promise.resolve([
        {
          harness: claudeHarness,
          ref: {
            sessionId: "s1",
            projectPath: "",
            mtimeMs: NOW - 5_000,
            loadEntries: async () => [
              { type: "mode", mode: "normal" },
              {
                cwd: "/Users/x/src/proj",
                type: "assistant",
                message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "/x/auth.ts" } }] },
              },
              { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
            ],
          },
          claude: {
            sessionId: "s1",
            transcriptPath: "/PD/-proj/s1.jsonl",
            configDir: "/Users/x/.claude",
            mtimeMs: NOW - 5_000,
            readLines: () =>
              Promise.resolve([
                `{"type":"mode","mode":"normal"}`,
                `{"cwd":"/Users/x/src/proj","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/x/auth.ts"}}]}}`,
                `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}`,
              ]),
          },
        },
      ]),
    liveProjectDirs: () => Promise.resolve(new Set(["/Users/x/src/proj"])),
    ...over,
  });
}

describe("SpexrDarkfactoryBackendService v2", () => {
  it("listTiles builds a working tile with a distilled action", async () => {
    const tiles = await svc().listTiles();
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      sessionId: "s1",
      harness: "claude",
      projectName: "proj",
      state: "working",
      actionLine: "Editing auth.ts",
      tool: "Edit",
    });
    expect(typeof tiles[0]!.accentId).toBe("number");
  });

  it("planFocus returns readonly-follow for a working session, resume-terminal for an idle one", async () => {
    const s = svc();
    await s.listTiles();
    expect((await s.planFocus("s1")).kind).toBe("readonly-follow"); // working elsewhere

    const idle = svc({ liveProjectDirs: () => Promise.resolve(new Set()) });
    await idle.listTiles();
    const plan = await idle.planFocus("s1");
    expect(plan.kind).toBe("resume-terminal");
    expect(plan.configDir).toBe("/Users/x/.claude");
  });

  it("summarize parses now/overview from the model and caches by mtime", async () => {
    let calls = 0;
    const s = svc({
      generator: {
        generate: async () => null,
        isAvailable: () => true,
        summarize: async () => {
          calls++;
          return "Now: editing the modal list component\nOverview: migrating browse-blueprints to the design system";
        },
      },
    });
    await s.listTiles();
    expect(await s.summarize("s1")).toEqual({
      now: "Editing the modal list component",
      overview: "Migrating browse-blueprints to the design system",
    });
    await s.summarize("s1");
    expect(calls).toBe(1); // cached by mtime
  });

  it("summarize returns empty fields when no model is available", async () => {
    const s = svc();
    await s.listTiles();
    expect(await s.summarize("s1")).toEqual({ now: "", overview: "" });
  });

  it("stitchBoundedLines returns whole lines untouched when not truncated", () => {
    expect(stitchBoundedLines("a\nb\nc", "", false)).toEqual(["a", "b", "c"]);
  });

  it("stitchBoundedLines drops the partial line at each cut and skips the middle", () => {
    // head ends mid-line ("par"), tail starts mid-line ("tial") — both dropped.
    expect(stitchBoundedLines('{"a":1}\n{"b":2}\npar', 'tial\n{"y":9}\n{"z":10}', true)).toEqual([
      '{"a":1}',
      '{"b":2}',
      '{"y":9}',
      '{"z":10}',
    ]);
  });

  it("planFocus falls back to readonly-follow when the session's config dir isn't resumable", async () => {
    const s = svc({
      liveProjectDirs: () => Promise.resolve(new Set()),
      resumableConfigDir: "/Users/x/.claude-perso", // session is in /Users/x/.claude
    });
    await s.listTiles();
    expect((await s.planFocus("s1")).kind).toBe("readonly-follow");
  });

  it("merges opencode sessions from the harness and marks them always resumable", async () => {
    const { opencodeHarness } = await import("../../common/harness/opencode-harness.js");
    const s = svc({
      listTranscripts: () =>
        Promise.resolve([
          {
            harness: opencodeHarness,
            ref: {
              sessionId: "ses_abc123",
              projectPath: "/Users/x/src/oc-proj",
              mtimeMs: NOW - 60_000,
              loadEntries: async () => [
                { message: { role: "user", content: [{ type: "text", text: "fix the login" }] } },
                { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }] } },
              ],
            },
          },
        ]),
      liveProjectDirs: () => Promise.resolve(new Set()),
    });
    const tiles = await s.listTiles();
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ sessionId: "ses_abc123", harness: "opencode", projectName: "oc-proj", goal: "fix the login" });
    // idle + opencode → always resumable (no config-dir mismatch possible)
    expect((await s.planFocus("ses_abc123")).kind).toBe("resume-terminal");
  });

  it("keeps the pipeline intact when an opencode session has no cwd", async () => {
    const { opencodeHarness } = await import("../../common/harness/opencode-harness.js");
    const s = svc({
      listTranscripts: () =>
        Promise.resolve([
          {
            harness: opencodeHarness,
            ref: { sessionId: "ses_empty", projectPath: "", mtimeMs: NOW - 5_000, loadEntries: async () => [] },
          },
        ]),
    });
    const tiles = await s.listTiles();
    expect(tiles).toHaveLength(0); // no cwd → skipped; nothing crashes
  });
});

interface WatchCall {
  dir: string;
  recursive: boolean;
}

function fakeWatch(calls: WatchCall[]): (dir: string, recursive: boolean, onChange: () => void) => FSWatcher {
  return (dir, recursive) => {
    calls.push({ dir, recursive });
    return { close: () => {} } as unknown as FSWatcher;
  };
}

const fakeClient: SpexrDarkfactoryClient = { onTilesChanged: () => {}, onFollowChunk: () => {} };

describe("wall watcher", () => {
  it("watches the opencode data dir alongside the Claude config dirs when opencode is installed", async () => {
    const calls: WatchCall[] = [];
    const s = svc({
      configDirs: ["/c1", "/c2"],
      detect: (h) => h.id === "opencode",
      opencodeDataDir: () => "/oc/data",
      watchDir: fakeWatch(calls),
    });
    s.setClient(fakeClient);
    await vi.waitFor(() => expect(calls.some((c) => c.dir === "/oc/data")).toBe(true), { timeout: 1000 });
    expect(calls).toContainEqual({ dir: "/c1/projects", recursive: true });
    expect(calls).toContainEqual({ dir: "/c2/projects", recursive: true });
    expect(calls).toContainEqual({ dir: "/oc/data", recursive: false });
    s.dispose();
  });

  it("skips the opencode data dir when opencode is not installed", async () => {
    const calls: WatchCall[] = [];
    const s = svc({
      configDirs: ["/c1"],
      detect: (h) => h.id === "claude",
      opencodeDataDir: () => "/oc/data",
      watchDir: fakeWatch(calls),
    });
    s.setClient(fakeClient);
    await vi.waitFor(() => expect(calls.some((c) => c.dir === "/c1/projects")).toBe(true), { timeout: 1000 });
    await new Promise((r) => setTimeout(r, 50)); // let the async arm complete before asserting absence
    expect(calls.some((c) => c.dir === "/oc/data")).toBe(false);
    s.dispose();
  });

  it("derives the opencode data dir from XDG_DATA_HOME, falling back to ~/.local/share/opencode", () => {
    expect(defaultOpencodeDataDir({ XDG_DATA_HOME: "/xdg" })).toBe("/xdg/opencode");
    expect(defaultOpencodeDataDir({ XDG_DATA_HOME: "  " })).toBe(join(homedir(), ".local", "share", "opencode"));
    expect(defaultOpencodeDataDir({})).toBe(join(homedir(), ".local", "share", "opencode"));
  });
});

describe("forEachConcurrent", () => {
  it("processes every item without exceeding the concurrency limit", async () => {
    let inFlight = 0;
    let maxSeen = 0;
    const done: number[] = [];
    const items = Array.from({ length: 25 }, (_, i) => i);
    await forEachConcurrent(items, 8, async (i) => {
      inFlight++;
      maxSeen = Math.max(maxSeen, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      done.push(i);
      inFlight--;
    });
    expect(maxSeen).toBeLessThanOrEqual(8);
    expect(maxSeen).toBeGreaterThan(1); // genuinely parallel, not serialized
    expect([...done].sort((a, b) => a - b)).toEqual(items);
  });

  it("handles empty input", async () => {
    await forEachConcurrent([], 4, async () => {});
  });
});

type Pushable = { pushTiles(): Promise<void> };

describe("pushTiles coalescing + live-dir cache", () => {
  it("is single-flight: pushes during an in-flight scan coalesce into one follow-up scan", async () => {
    let scans = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const s = svc({
      configDirs: [],
      detect: () => false,
      listTranscripts: async () => { scans++; await gate; return []; },
    });
    s.setClient(fakeClient);
    const push = s as unknown as Pushable;
    const first = push.pushTiles(); // starts scan #1, holds on the gate
    push.pushTiles(); // in flight → only marks dirty
    push.pushTiles(); // in flight → only marks dirty
    await new Promise((r) => setTimeout(r, 10));
    release();
    await first;
    expect(scans).toBe(2); // #1 + exactly one coalesced follow-up, not three
    s.dispose();
  });

  it("reuses live-project dirs within the TTL and re-checks after it expires", async () => {
    let t = 1_000;
    let psCalls = 0;
    const s = svc({
      now: () => t,
      listTranscripts: () => Promise.resolve([]),
      liveProjectDirs: async () => { psCalls++; return new Set<string>(); },
    });
    await s.listTiles();
    await s.listTiles();
    expect(psCalls).toBe(1); // within TTL → served from cache
    t += 15_000; // LIVE_DIRS_TTL_MS
    await s.listTiles();
    expect(psCalls).toBe(2); // TTL expired → re-checked
  });
});
