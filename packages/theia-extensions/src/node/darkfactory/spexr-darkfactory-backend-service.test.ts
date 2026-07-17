import { describe, expect, it } from "vitest";
import { SpexrDarkfactoryBackendService } from "./spexr-darkfactory-backend-service.js";

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

  it("planFocus falls back to readonly-follow when the session's config dir isn't resumable", async () => {
    const s = svc({
      liveProjectDirs: () => Promise.resolve(new Set()),
      resumableConfigDir: "/Users/x/.claude-perso", // session is in /Users/x/.claude
    });
    await s.listTiles();
    expect((await s.planFocus("s1")).kind).toBe("readonly-follow");
  });
});
