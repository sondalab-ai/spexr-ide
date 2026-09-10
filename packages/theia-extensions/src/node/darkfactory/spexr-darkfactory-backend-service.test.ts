import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FSWatcher } from "node:fs";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  SpexrDarkfactoryBackendService,
  defaultOpencodeDataDir,
  forEachConcurrent,
} from "./spexr-darkfactory-backend-service.js";
import { stitchBoundedLines } from "./bounded-read.js";
import { configDirs as discoverConfigDirs } from "./config-dirs.js";
import { claudeHarness } from "../../common/harness/claude-harness.js";
import { loadSessionNames } from "./session-names-store.js";
import { loadProjectNames } from "./project-names-store.js";
import type { AgentTile, SpexrDarkfactoryClient } from "../../common/darkfactory-protocol.js";
import {
  MAX_PROJECT_NAME_CHARS,
  MAX_SESSION_NAME_CHARS,
} from "../../common/darkfactory-protocol.js";

const NOW = 100 * 3_600_000;

// Every service built here would otherwise read the developer's real
// ~/.spexr/session-names.json and ~/.spexr/project-names.json when it builds tiles.
let namesDir: string;
beforeAll(async () => {
  namesDir = await mkdtemp(join(tmpdir(), "spexr-df-names-"));
  process.env["SPEXR_SESSION_NAMES"] = join(namesDir, "session-names.json");
  process.env["SPEXR_PROJECT_NAMES"] = join(namesDir, "project-names.json");
});
afterAll(async () => {
  delete process.env["SPEXR_SESSION_NAMES"];
  delete process.env["SPEXR_PROJECT_NAMES"];
  await rm(namesDir, { recursive: true, force: true });
});

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
                message: {
                  role: "assistant",
                  content: [{ type: "tool_use", name: "Edit", input: { file_path: "/x/auth.ts" } }],
                },
              },
              {
                type: "user",
                message: {
                  role: "user",
                  content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
                },
              },
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
    const dir = await mkdtemp(join(tmpdir(), "spexr-df-"));
    const transcriptPath = join(dir, "s1.jsonl");
    await writeFile(
      transcriptPath,
      [
        `{"type":"mode","mode":"normal"}`,
        `{"cwd":"/Users/x/src/proj","type":"user","message":{"role":"user","content":[{"type":"text","text":"fix the login page: the session cookie is dropped after the redirect and users get logged out"}]}}`,
        `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I will inspect the redirect handler."}]}}`,
        `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/x/auth.ts"}}]}}`,
        `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}`,
      ].join("\n"),
    );
    try {
      const s = svc({
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
                    type: "user",
                    message: {
                      role: "user",
                      content: [
                        {
                          type: "text",
                          text: "fix the login page: the session cookie is dropped after the redirect and users get logged out",
                        },
                      ],
                    },
                  },
                  {
                    type: "assistant",
                    message: {
                      role: "assistant",
                      content: [{ type: "text", text: "I will inspect the redirect handler." }],
                    },
                  },
                  {
                    type: "assistant",
                    message: {
                      role: "assistant",
                      content: [
                        { type: "tool_use", name: "Edit", input: { file_path: "/x/auth.ts" } },
                      ],
                    },
                  },
                  {
                    type: "user",
                    message: {
                      role: "user",
                      content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
                    },
                  },
                ],
              },
              claude: {
                sessionId: "s1",
                transcriptPath,
                configDir: "/Users/x/.claude",
                mtimeMs: NOW - 5_000,
                readLines: () => Promise.resolve([]),
              },
            },
          ]),
        generator: {
          generate: async () => null,
          isAvailable: () => true,
          summarize: async (_prompt, kind) => {
            calls++;
            return kind === "overview"
              ? "migrating browse-blueprints to the design system"
              : "inspecting the redirect handler that drops the cookie";
          },
        },
      });
      await s.listTiles();
      // Both lines are model-written (two separate single-clause asks), cleaned.
      expect(await s.summarize("s1")).toEqual({
        now: "Inspecting the redirect handler that drops the cookie",
        overview: "Migrating browse-blueprints to the design system",
      });
      await s.summarize("s1");
      expect(calls).toBe(2); // two asks (now + overview) on the first call; cached by mtime after
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

  it("planFocus routes a working opencode session to readonly-follow (fork stays an explicit CTA)", async () => {
    const { opencodeHarness } = await import("../../common/harness/opencode-harness.js");
    const s = svc({
      listTranscripts: () =>
        Promise.resolve([
          {
            harness: opencodeHarness,
            ref: {
              sessionId: "ses_live",
              projectPath: "/Users/x/src/oc-live",
              mtimeMs: NOW - 5_000,
              loadEntries: async () => [
                {
                  message: {
                    role: "user",
                    content: [{ type: "text", text: "keep building the dashboard widgets" }],
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }],
                  },
                },
                { message: { role: "user", content: [{ type: "tool_result", is_error: false }] } },
              ],
            },
          },
        ]),
      liveProjectDirs: () => Promise.resolve(new Set(["/Users/x/src/oc-live"])),
    });
    const tiles = await s.listTiles();
    expect(tiles[0]).toMatchObject({ sessionId: "ses_live", state: "working" });
    expect((await s.planFocus("ses_live")).kind).toBe("readonly-follow");
  });

  it("listConfigDirs names every discovered account, the default one first", async () => {
    const s = svc({
      configDirs: ["/Users/x/.claude-perso", "/Users/x/.claude"],
      defaultAccountDir: "/Users/x/.claude",
    });
    expect(await s.listConfigDirs()).toEqual([
      { path: "/Users/x/.claude", label: ".claude", isDefault: true },
      { path: "/Users/x/.claude-perso", label: ".claude-perso", isDefault: false },
    ]);
  });

  // SPEXR is often started from a shell that exports CLAUDE_CONFIG_DIR. That
  // value decides what an inherited --resume attaches to, and nothing else: a
  // new session gets the account exported into its own shell line, so labelling
  // the launcher with it pre-selected an account the user never picked.
  it("listConfigDirs ignores the inherited config dir when marking the default", async () => {
    const s = svc({
      configDirs: ["/Users/x/.claude", "/Users/x/.claude-perso"],
      resumableConfigDir: "/Users/x/.claude-perso",
      defaultAccountDir: "/Users/x/.claude",
    });
    expect(await s.listConfigDirs()).toEqual([
      { path: "/Users/x/.claude", label: ".claude", isDefault: true },
      { path: "/Users/x/.claude-perso", label: ".claude-perso", isDefault: false },
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
                {
                  message: {
                    role: "assistant",
                    content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }],
                  },
                },
              ],
            },
          },
        ]),
      liveProjectDirs: () => Promise.resolve(new Set()),
    });
    const tiles = await s.listTiles();
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      sessionId: "ses_abc123",
      harness: "opencode",
      projectName: "oc-proj",
      goal: "fix the login",
    });
    // idle + opencode → always resumable (no config-dir mismatch possible)
    expect((await s.planFocus("ses_abc123")).kind).toBe("resume-terminal");
  });

  it("summarizes opencode sessions from their export entries (no transcript file)", async () => {
    const { opencodeHarness } = await import("../../common/harness/opencode-harness.js");
    const seen: Record<string, string> = {};
    const s = svc({
      listTranscripts: () =>
        Promise.resolve([
          {
            harness: opencodeHarness,
            ref: {
              sessionId: "ses_sum",
              projectPath: "/Users/x/src/oc-proj",
              mtimeMs: NOW - 60_000,
              // enough rendered context to clear MIN_SUMMARY_CHARS (thin sessions are skipped)
              loadEntries: async () => [
                {
                  message: {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: "fix the login page: the session cookie is dropped after the redirect and users get logged out",
                      },
                    ],
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "I will inspect the redirect handler." }],
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }],
                  },
                },
              ],
            },
          },
        ]),
      liveProjectDirs: () => Promise.resolve(new Set()),
      generator: {
        generate: async () => null,
        isAvailable: () => true,
        summarize: async (prompt, kind) => {
          seen[kind] = prompt;
          return kind === "overview" ? "fixing the login bug" : "running the login tests";
        },
      },
    });
    await s.listTiles();
    // Both lines model-written from real content (two separate single-clause asks).
    expect(await s.summarize("ses_sum")).toEqual({
      now: "Running the login tests",
      overview: "Fixing the login bug",
    });
    expect(seen.overview).toContain("fix the login page"); // overview is grounded in the session goal
    expect(seen.overview).toContain("inspect the redirect handler"); // …plus recent progress prose
    expect(seen.overview).not.toContain("[Bash:"); // tool chips stay out — no enumeration temptation
    expect(seen.now).toContain("inspect the redirect handler"); // now is fed only the recent prose
    expect(seen.now).not.toContain("fix the login page"); // …not the goal
  });

  it("summarizes a resumed session with a terse goal but substantial recent work", async () => {
    const { opencodeHarness } = await import("../../common/harness/opencode-harness.js");
    let calls = 0;
    const s = svc({
      listTranscripts: () =>
        Promise.resolve([
          {
            harness: opencodeHarness,
            ref: {
              sessionId: "ses_resumed",
              projectPath: "/Users/x/src/oc-proj",
              mtimeMs: NOW - 60_000,
              // Terse goal ("continua") — the old turns-digest gate cleared 120 only
              // because it added tool-chip lines; chip-free prose must still qualify.
              loadEntries: async () => [
                { message: { role: "user", content: [{ type: "text", text: "continua" }] } },
                {
                  message: {
                    role: "assistant",
                    content: [
                      {
                        type: "text",
                        text: "tracing the redirect handler that drops the session cookie",
                      },
                    ],
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: [
                      {
                        type: "text",
                        text: "the cookie flag is cleared before the 302 response is written",
                      },
                    ],
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: [
                      { type: "tool_use", name: "Edit", input: { file_path: "/x/auth.ts" } },
                    ],
                  },
                },
              ],
            },
          },
        ]),
      liveProjectDirs: () => Promise.resolve(new Set()),
      generator: {
        generate: async () => null,
        isAvailable: () => true,
        summarize: async (_prompt, kind) => {
          calls++;
          return kind === "overview"
            ? "restoring the dropped session cookie on redirect"
            : "editing the auth redirect handler";
        },
      },
    });
    await s.listTiles();
    expect(await s.summarize("ses_resumed")).toEqual({
      now: "Editing the auth redirect handler",
      overview: "Restoring the dropped session cookie on redirect",
    });
    expect(calls).toBe(2); // terse goal did not gate the model out
  });

  it("skips inference on thin context but still shows the deterministic action line", async () => {
    const { opencodeHarness } = await import("../../common/harness/opencode-harness.js");
    let calls = 0;
    const s = svc({
      listTranscripts: () =>
        Promise.resolve([
          {
            harness: opencodeHarness,
            ref: {
              sessionId: "ses_thin",
              projectPath: "/Users/x/src/oc-proj",
              mtimeMs: NOW - 60_000,
              loadEntries: async () => [
                { message: { role: "user", content: [{ type: "text", text: "test" }] } },
                {
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "Test ricevuto." }],
                  },
                },
              ],
            },
          },
        ]),
      liveProjectDirs: () => Promise.resolve(new Set()),
      generator: {
        generate: async () => null,
        isAvailable: () => true,
        summarize: async () => {
          calls++;
          return "Now: x\nOverview: y";
        },
      },
    });
    await s.listTiles();
    expect(await s.summarize("ses_thin")).toEqual({ now: "Test ricevuto.", overview: "" });
    expect(calls).toBe(0); // thin context → no inference, no fabrication
  });

  it("keeps the pipeline intact when an opencode session has no cwd", async () => {
    const { opencodeHarness } = await import("../../common/harness/opencode-harness.js");
    const s = svc({
      listTranscripts: () =>
        Promise.resolve([
          {
            harness: opencodeHarness,
            ref: {
              sessionId: "ses_empty",
              projectPath: "",
              mtimeMs: NOW - 5_000,
              loadEntries: async () => [],
            },
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

function fakeWatch(
  calls: WatchCall[],
): (dir: string, recursive: boolean, onChange: () => void) => FSWatcher {
  return (dir, recursive) => {
    calls.push({ dir, recursive });
    return { close: () => {}, on: () => {} } as unknown as FSWatcher;
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
    await vi.waitFor(() => expect(calls.some((c) => c.dir === "/oc/data")).toBe(true), {
      timeout: 1000,
    });
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
    await vi.waitFor(() => expect(calls.some((c) => c.dir === "/c1/projects")).toBe(true), {
      timeout: 1000,
    });
    await new Promise((r) => setTimeout(r, 50)); // let the async arm complete before asserting absence
    expect(calls.some((c) => c.dir === "/oc/data")).toBe(false);
    s.dispose();
  });

  it("derives the opencode data dir from XDG_DATA_HOME, falling back to ~/.local/share/opencode", () => {
    expect(defaultOpencodeDataDir({ XDG_DATA_HOME: "/xdg" })).toBe("/xdg/opencode");
    expect(defaultOpencodeDataDir({ XDG_DATA_HOME: "  " })).toBe(
      join(homedir(), ".local", "share", "opencode"),
    );
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
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const s = svc({
      configDirs: [],
      detect: () => false,
      listTranscripts: async () => {
        scans++;
        await gate;
        return [];
      },
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
      liveProjectDirs: async () => {
        psCalls++;
        return new Set<string>();
      },
    });
    await s.listTiles();
    await s.listTiles();
    expect(psCalls).toBe(1); // within TTL → served from cache
    t += 15_000; // LIVE_DIRS_TTL_MS
    await s.listTiles();
    expect(psCalls).toBe(2); // TTL expired → re-checked
  });
});

/** A minimal but real Claude transcript: has a cwd, a mode line (→ interactive) and a prompt. */
async function writeSession(home: string, configDir: string, sessionId: string): Promise<void> {
  const projectDir = join(home, configDir, "projects", "-tmp-proj");
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, `${sessionId}.jsonl`),
    [
      `{"type":"mode","mode":"normal"}`,
      `{"cwd":"${join(home, "proj")}","type":"user","message":{"role":"user","content":[{"type":"text","text":"fix the auth check"}]}}`,
      `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"on it"}]}}`,
    ].join("\n"),
  );
}

describe("config-dir rediscovery", () => {
  // The regression this guards: config dirs used to be discovered once, in the
  // constructor. A session started outside SPEXR under an account dir that did
  // not exist (or had no `projects/`) at startup was then invisible for the life
  // of the process — no watcher covered it, and no rescan would ever look there.
  it("picks up a session under a config dir that appeared after construction", async () => {
    const home = await mkdtemp(join(tmpdir(), "spexr-df-home-"));
    try {
      await writeSession(home, ".claude", "s-known");
      const s = new SpexrDarkfactoryBackendService({
        // Stands in for production's per-scan discovery, running the real one.
        configDirs: () => discoverConfigDirs({}, { home }),
        detect: (h) => h.id === "claude",
        liveProjectDirs: () => Promise.resolve(null),
      });
      expect((await s.listTiles()).map((t) => t.sessionId)).toEqual(["s-known"]);

      await writeSession(home, ".claude-later", "s-outside");
      const after = (await s.listTiles()).map((t) => t.sessionId);
      expect(after).toContain("s-outside");
      expect(after).toContain("s-known");
      expect(await s.listConfigDirs()).toContainEqual({
        path: join(home, ".claude-later"),
        label: ".claude-later",
        isDefault: false,
      });
      s.dispose();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("wall polling", () => {
  it("rescans on the poll interval without any watcher event", async () => {
    vi.useFakeTimers();
    try {
      let scans = 0;
      const s = svc({
        configDirs: [],
        detect: () => false,
        watchDir: fakeWatch([]),
        listTranscripts: async () => {
          scans++;
          return [];
        },
      });
      s.setClient(fakeClient);
      expect(scans).toBe(0); // arming the watchers alone does not scan
      await vi.advanceTimersByTimeAsync(20_000); // POLL_INTERVAL_MS
      expect(scans).toBe(1);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(scans).toBe(2);
      s.dispose();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(scans).toBe(2); // disposed → the timer is gone
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("searchSessions", () => {
  /**
   * `count` sessions, the last of which carries the OLDEST mtime: listTiles
   * sorts descending and keeps the first RECENT_LIMIT (60), so only that one
   * ends up outside the scan window and comes back as an archived hit.
   */
  function searchSvc(count: number, archivedGoal: string, indexPath: string) {
    const refs = Array.from({ length: count }, (_, i) => {
      const last = i === count - 1;
      const id = last ? "archived" : `s${i}`;
      const goal = last ? archivedGoal : `unrelated maintenance chore number ${i}`;
      const cwd = last ? "/Users/x/src/mine/spexr" : `/Users/x/src/proj${i}`;
      const mtimeMs = last ? NOW - 10_000_000 : NOW - 1_000 * i;
      const lines = [
        `{"type":"mode","mode":"normal"}`,
        `{"cwd":"${cwd}","type":"user","message":{"role":"user","content":[{"type":"text","text":"${goal}"}]}}`,
        `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"${cwd}/src/theme.css"}}]}}`,
      ];
      return {
        harness: claudeHarness,
        ref: {
          sessionId: id,
          projectPath: "",
          mtimeMs,
          loadEntries: async () => lines.map((l) => JSON.parse(l)),
        },
        claude: {
          sessionId: id,
          transcriptPath: `/PD/-proj/${id}.jsonl`,
          configDir: "/Users/x/.claude",
          mtimeMs,
          readLines: () => Promise.resolve(lines),
        },
      };
    });
    return svc({
      listTranscripts: () => Promise.resolve(refs),
      liveProjectDirs: () => Promise.resolve(new Set<string>()),
      sessionIndexPath: indexPath,
      // Two directions only: anything about effects, and everything else.
      embed: async (texts: string[]) =>
        texts.map((t) =>
          /effect/i.test(t) ? Float32Array.from([1, 0]) : Float32Array.from([0, 1]),
        ),
    });
  }

  it("returns [] for an empty query", async () => {
    expect(await svc().searchSessions("   ")).toEqual([]);
  });

  it("opens an archived hit even after a scan has cleared the live index", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spexr-df-search-"));
    try {
      const s = searchSvc(61, "adding new effects to the spexr design system", join(dir, "i.json"));
      await s.indexNow();
      await s.listTiles(); // clears the scan-owned index, as every poll does

      const hits = await s.searchSessions("new effects in the design system");
      const archived = hits.find((h) => h.archived);
      expect(archived).toBeDefined();
      expect(archived!.tile.projectName).toBe("spexr");
      expect(archived!.tile.goal).toContain("effects");
      expect(hits[0]!.tile.sessionId).toBe("archived");
      // The archived branch builds its hits in a pass of its own, so it is the
      // one that can silently lose a match field the other still carries.
      expect(archived!.dense + archived!.lexical).toBeCloseTo(archived!.score, 10);
      expect(archived!.terms).toContain("effects");

      const plan = await s.planFocus("archived");
      expect(plan.projectPath).toBe("/Users/x/src/mine/spexr");
      expect(plan.configDir).toBe("/Users/x/.claude");
      expect(plan.kind).toBe("resume-terminal");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns a session inside the scan window as the scan built it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spexr-df-search-"));
    try {
      const s = searchSvc(3, "adding new effects to the spexr design system", join(dir, "i.json"));
      await s.indexNow();
      const tiles = await s.listTiles();
      const hits = await s.searchSessions("new effects in the design system");
      const hit = hits.find((h) => h.tile.sessionId === "archived");
      expect(hit!.archived).toBe(false);
      expect(hit!.tile).toBe(tiles.find((t) => t.sessionId === "archived"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("renameSession", () => {
  async function namedSvc(): Promise<{
    s: ReturnType<typeof svc>;
    pushed: AgentTile[][];
    dir: string;
  }> {
    const dir = await mkdtemp(join(tmpdir(), "spexr-df-rename-"));
    const s = svc({ sessionNamesPath: join(dir, "names.json") });
    const pushed: AgentTile[][] = [];
    s.setClient({
      onTilesChanged: (tiles) => pushed.push(tiles),
      onFollowChunk: () => {},
      onSessionIndexProgress: () => {},
    } as SpexrDarkfactoryClient);
    return { s, pushed, dir };
  }

  it("names a session and pushes the renamed tile without waiting for a scan", async () => {
    const { s, pushed, dir } = await namedSvc();
    try {
      await s.listTiles();
      pushed.length = 0;
      await s.renameSession("s1", "  Typography fix  ");
      expect(pushed.at(-1)!.find((t) => t.sessionId === "s1")!.customName).toBe("Typography fix");
      expect((await s.listTiles())[0]!.customName).toBe("Typography fix");
      s.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("survives a restart, because the name is on disk and not in the tile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spexr-df-rename-"));
    try {
      const first = svc({ sessionNamesPath: join(dir, "names.json") });
      await first.listTiles();
      await first.renameSession("s1", "Typography fix");
      first.dispose();

      const second = svc({ sessionNamesPath: join(dir, "names.json") });
      expect((await second.listTiles())[0]!.customName).toBe("Typography fix");
      second.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("clears the name on an empty string, leaving no blank heading behind", async () => {
    const { s, pushed, dir } = await namedSvc();
    try {
      await s.listTiles();
      await s.renameSession("s1", "Typography fix");
      await s.renameSession("s1", "   ");
      expect(pushed.at(-1)!.find((t) => t.sessionId === "s1")).not.toHaveProperty("customName");
      expect((await s.listTiles())[0]).not.toHaveProperty("customName");
      s.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("caps a name at the width a card head can carry", async () => {
    const { s, dir } = await namedSvc();
    try {
      await s.listTiles();
      await s.renameSession("s1", "x".repeat(200));
      expect((await s.listTiles())[0]!.customName).toHaveLength(MAX_SESSION_NAME_CHARS);
      s.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stores a name for a session the wall has not scanned, and pushes nothing", async () => {
    const { s, pushed, dir } = await namedSvc();
    try {
      await s.renameSession("never-scanned", "Old work");
      expect(pushed).toEqual([]);
      s.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("renameProject", () => {
  /** Two sessions in one project, plus one in another, so a rename has a scope to respect. */
  function ref(sessionId: string, cwd: string) {
    return {
      harness: claudeHarness,
      ref: {
        sessionId,
        projectPath: "",
        mtimeMs: NOW - 5_000,
        loadEntries: async () => [
          { type: "mode", mode: "normal" },
          {
            cwd,
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "tool_use", name: "Edit", input: { file_path: "/x/a.ts" } }],
            },
          },
        ],
      },
      claude: {
        sessionId,
        transcriptPath: `/PD/-p/${sessionId}.jsonl`,
        configDir: "/Users/x/.claude",
        mtimeMs: NOW - 5_000,
        readLines: () => Promise.resolve([]),
      },
    };
  }

  async function projectSvc(): Promise<{
    s: ReturnType<typeof svc>;
    pushed: AgentTile[][];
    dir: string;
  }> {
    const dir = await mkdtemp(join(tmpdir(), "spexr-df-project-rename-"));
    const s = svc({
      projectNamesPath: join(dir, "projects.json"),
      listTranscripts: () =>
        Promise.resolve([
          ref("a", "/Users/x/src/proj"),
          ref("b", "/Users/x/src/proj"),
          ref("c", "/Users/x/src/other"),
        ]),
    });
    const pushed: AgentTile[][] = [];
    s.setClient({
      onTilesChanged: (tiles) => pushed.push(tiles),
      onFollowChunk: () => {},
      onSessionIndexProgress: () => {},
    } as SpexrDarkfactoryClient);
    return { s, pushed, dir };
  }

  const named = (tiles: AgentTile[], id: string) =>
    tiles.find((t) => t.sessionId === id)!.projectCustomName;

  it("names every session of the project in one push, and leaves the others alone", async () => {
    const { s, pushed, dir } = await projectSvc();
    try {
      await s.listTiles();
      pushed.length = 0;
      await s.renameProject("/Users/x/src/proj", "  Day job  ");
      expect(pushed).toHaveLength(1);
      expect(named(pushed[0]!, "a")).toBe("Day job");
      expect(named(pushed[0]!, "b")).toBe("Day job");
      expect(named(pushed[0]!, "c")).toBeUndefined();
      s.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("survives a restart, because the name is on disk and not in the tile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spexr-df-project-rename-"));
    try {
      const first = svc({ projectNamesPath: join(dir, "projects.json") });
      await first.listTiles();
      await first.renameProject("/Users/x/src/proj", "Day job");
      first.dispose();

      const second = svc({ projectNamesPath: join(dir, "projects.json") });
      expect((await second.listTiles())[0]!.projectCustomName).toBe("Day job");
      second.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("matches the project despite a trailing slash on the path it is given", async () => {
    const { s, dir } = await projectSvc();
    try {
      await s.listTiles();
      await s.renameProject("/Users/x/src/proj/", "Day job");
      expect(named(await s.listTiles(), "a")).toBe("Day job");
      s.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("clears the name on an empty string, leaving the folder name to stand", async () => {
    const { s, pushed, dir } = await projectSvc();
    try {
      await s.listTiles();
      await s.renameProject("/Users/x/src/proj", "Day job");
      await s.renameProject("/Users/x/src/proj", "   ");
      expect(pushed.at(-1)!.find((t) => t.sessionId === "a")).not.toHaveProperty("projectCustomName");
      expect((await s.listTiles()).find((t) => t.sessionId === "a")).not.toHaveProperty(
        "projectCustomName",
      );
      s.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("caps a name at the width a group header can carry", async () => {
    const { s, dir } = await projectSvc();
    try {
      await s.listTiles();
      await s.renameProject("/Users/x/src/proj", "x".repeat(200));
      expect(named(await s.listTiles(), "a")).toHaveLength(MAX_PROJECT_NAME_CHARS);
      s.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stores a name for a project the wall has not scanned, and pushes nothing", async () => {
    const { s, pushed, dir } = await projectSvc();
    try {
      await s.renameProject("/Users/x/src/never-scanned", "Old work");
      expect(pushed).toEqual([]);
      s.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the name sweep", () => {
  /** A clock the test moves, so a second sweep can come due without waiting ten minutes. */
  function clock(): { now: () => number; advance: (ms: number) => void } {
    let at = NOW;
    return { now: () => at, advance: (ms) => (at += ms) };
  }

  const TEN_MINUTES = 10 * 60_000;

  /** A session of some other project, so a scan can be short of `s1` without being empty. */
  function otherRef(sessionId: string) {
    return {
      harness: claudeHarness,
      ref: {
        sessionId,
        projectPath: "",
        mtimeMs: NOW - 5_000,
        loadEntries: async () => [{ cwd: "/Users/x/src/other", type: "user", message: { role: "user", content: "hi" } }],
      },
      claude: {
        sessionId,
        transcriptPath: `/PD/-other/${sessionId}.jsonl`,
        configDir: "/Users/x/.claude",
        mtimeMs: NOW - 5_000,
        readLines: () => Promise.resolve([]),
      },
    };
  }

  async function storeDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "spexr-df-sweep-"));
  }

  it("forgets the name of a session whose transcript is gone, once a second sweep agrees", async () => {
    const dir = await storeDir();
    const namesPath = join(dir, "names.json");
    try {
      const c = clock();
      const named = svc({ now: c.now, sessionNamesPath: namesPath });
      await named.listTiles();
      await named.renameSession("s1", "Typography fix");
      named.dispose();

      const gone = svc({
        now: c.now,
        sessionNamesPath: namesPath,
        listTranscripts: () => Promise.resolve([otherRef("s2")]),
      });
      await gone.listTiles(); // first strike: the name is kept
      expect((await loadSessionNames(namesPath)).get("s1")).toBe("Typography fix");
      c.advance(TEN_MINUTES + 1);
      await gone.listTiles(); // second strike: the name goes
      expect(await loadSessionNames(namesPath)).toEqual(new Map());
      gone.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a name the sweep has missed only once, so a flaky scan costs nothing", async () => {
    const dir = await storeDir();
    const namesPath = join(dir, "names.json");
    try {
      const c = clock();
      const named = svc({ now: c.now, sessionNamesPath: namesPath });
      await named.listTiles();
      await named.renameSession("s1", "Typography fix");
      named.dispose();

      const flaky = svc({
        now: c.now,
        sessionNamesPath: namesPath,
        listTranscripts: () => Promise.resolve([otherRef("s2")]),
      });
      await flaky.listTiles();
      c.advance(TEN_MINUTES + 1);
      flaky.dispose();

      // The session is back on the second sweep: the first strike is forgotten.
      const back = svc({ now: c.now, sessionNamesPath: namesPath });
      await back.listTiles();
      expect((await loadSessionNames(namesPath)).get("s1")).toBe("Typography fix");
      back.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps every name when the scan came back empty, which is never proof", async () => {
    const dir = await storeDir();
    const namesPath = join(dir, "names.json");
    try {
      const c = clock();
      const named = svc({ now: c.now, sessionNamesPath: namesPath });
      await named.listTiles();
      await named.renameSession("s1", "Typography fix");
      named.dispose();

      const blind = svc({
        now: c.now,
        sessionNamesPath: namesPath,
        listTranscripts: () => Promise.resolve([]),
      });
      await blind.listTiles();
      c.advance(TEN_MINUTES + 1);
      await blind.listTiles();
      expect((await loadSessionNames(namesPath)).get("s1")).toBe("Typography fix");
      blind.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("forgets the name of a project whose folder was deleted", async () => {
    const dir = await storeDir();
    const projectsPath = join(dir, "projects.json");
    try {
      const c = clock();
      const named = svc({ now: c.now, projectNamesPath: projectsPath });
      await named.listTiles();
      await named.renameProject("/Users/x/src/proj", "Day job");
      named.dispose();

      const swept = svc({
        now: c.now,
        projectNamesPath: projectsPath,
        // The project folder is gone; its parent is still there.
        dirExists: (p) => Promise.resolve(p === "/Users/x/src"),
      });
      await swept.listTiles();
      expect(await loadProjectNames(projectsPath)).toEqual(new Map());
      swept.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a project name when the parent is unreachable too, as an unplugged volume is", async () => {
    const dir = await storeDir();
    const projectsPath = join(dir, "projects.json");
    try {
      const c = clock();
      const named = svc({ now: c.now, projectNamesPath: projectsPath });
      await named.listTiles();
      await named.renameProject("/Users/x/src/proj", "Day job");
      named.dispose();

      const swept = svc({
        now: c.now,
        projectNamesPath: projectsPath,
        dirExists: () => Promise.resolve(false),
      });
      await swept.listTiles();
      expect((await loadProjectNames(projectsPath)).get("/Users/x/src/proj")).toBe("Day job");
      swept.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("renameSession and the search index", () => {
  /**
   * Two sessions with unremarkable goals, indexed. The encoder here answers on
   * one axis only — "hydra" or not — so a query matches by the lexical half and
   * by a vector the rename had to re-encode, not by chance.
   */
  function indexedSvc(indexPath: string, namesPath: string) {
    const refs = ["s1", "s2"].map((id) => {
      const lines = [
        `{"type":"mode","mode":"normal"}`,
        `{"cwd":"/Users/x/src/proj","type":"user","message":{"role":"user","content":[{"type":"text","text":"routine maintenance chore ${id}"}]}}`,
      ];
      return {
        harness: claudeHarness,
        ref: {
          sessionId: id,
          projectPath: "",
          mtimeMs: NOW - 1_000,
          loadEntries: async () => lines.map((l) => JSON.parse(l)),
        },
        claude: {
          sessionId: id,
          transcriptPath: `/PD/-proj/${id}.jsonl`,
          configDir: "/Users/x/.claude",
          mtimeMs: NOW - 1_000,
          readLines: () => Promise.resolve(lines),
        },
      };
    });
    return svc({
      listTranscripts: () => Promise.resolve(refs),
      liveProjectDirs: () => Promise.resolve(new Set<string>()),
      sessionIndexPath: indexPath,
      sessionNamesPath: namesPath,
      embed: async (texts: string[]) =>
        texts.map((t) => (/hydra/i.test(t) ? Float32Array.from([1, 0]) : Float32Array.from([0, 1]))),
    });
  }

  it("finds a session by the name it was just given, without waiting for a crawl", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spexr-df-rename-index-"));
    try {
      const s = indexedSvc(join(dir, "i.json"), join(dir, "names.json"));
      await s.indexNow();
      await s.listTiles();
      expect(await s.searchSessions("hydra")).toEqual([]);

      await s.renameSession("s2", "Hydra migration");
      const hits = await s.searchSessions("hydra");
      expect(hits.map((h) => h.tile.sessionId)).toEqual(["s2"]);
      expect(hits[0]!.tile.customName).toBe("Hydra migration");
      s.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops matching a name that was replaced, rather than keeping both", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spexr-df-rename-index-"));
    try {
      const s = indexedSvc(join(dir, "i.json"), join(dir, "names.json"));
      await s.indexNow();
      await s.listTiles();
      await s.renameSession("s2", "Hydra migration");
      await s.renameSession("s2", "Kraken migration");
      expect(await s.searchSessions("hydra")).toEqual([]);
      s.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("carries the name into a crawl, so a restart indexes it named", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spexr-df-rename-index-"));
    try {
      const first = indexedSvc(join(dir, "i.json"), join(dir, "names.json"));
      await first.renameSession("s2", "Hydra migration"); // before any index exists
      first.dispose();

      const second = indexedSvc(join(dir, "i.json"), join(dir, "names.json"));
      await second.indexNow();
      await second.listTiles();
      expect((await second.searchSessions("hydra")).map((h) => h.tile.sessionId)).toEqual(["s2"]);
      second.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
