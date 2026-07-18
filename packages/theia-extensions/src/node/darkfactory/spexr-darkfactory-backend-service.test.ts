import { describe, expect, it } from "vitest";
import { SpexrDarkfactoryBackendService, stitchBoundedLines } from "./spexr-darkfactory-backend-service.js";

const NOW = 100 * 3_600_000;

function svc(over: Partial<ConstructorParameters<typeof SpexrDarkfactoryBackendService>[0]> = {}) {
  return new SpexrDarkfactoryBackendService({
    now: () => NOW,
    resumableConfigDir: "/Users/x/.claude",
    listTranscripts: () =>
      Promise.resolve([
        {
          sessionId: "s1",
          transcriptPath: "/PD/-proj/s1.jsonl",
          configDir: "/Users/x/.claude",
          mtimeMs: NOW - 5_000,
          readLines: () =>
            Promise.resolve([
              `{"type":"mode","mode":"normal"}`,
              `{"cwd":"/Users/x/src/proj","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/x/auth.ts"}}]}}`,
            ]),
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
});
