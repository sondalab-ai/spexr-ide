import { describe, expect, it } from "vitest";
import { SpexrDarkfactoryBackendService } from "./spexr-darkfactory-backend-service.js";

const IDLE_WINDOW = 12 * 3_600_000;

function svc(over: Partial<ConstructorParameters<typeof SpexrDarkfactoryBackendService>[0]>) {
  return new SpexrDarkfactoryBackendService({
    projectsDir: "/PD",
    now: () => 100 * 3_600_000,
    idleWindowMs: IDLE_WINDOW,
    listTranscripts: () => Promise.resolve([
      {
        sessionId: "s1", transcriptPath: "/PD/-proj/s1.jsonl", mtimeMs: 99 * 3_600_000,
        readLines: () => Promise.resolve([`{"cwd":"/Users/x/src/proj","gitBranch":"main","type":"user","message":{"role":"user","content":"do X"}}`]),
      },
    ]),
    openTranscriptPaths: () => Promise.resolve(new Set<string>()),
    generator: { generate: async () => null, summarize: async () => null, isAvailable: () => false },
    ...over,
  });
}

describe("SpexrDarkfactoryBackendService", () => {
  it("listAgents maps a transcript to an idle AgentSession", async () => {
    const agents = await svc({}).listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      sessionId: "s1", projectPath: "/Users/x/src/proj", projectName: "proj",
      gitBranch: "main", state: "idle", lastPrompt: "do X", turnCount: 1,
    });
  });

  it("summarize falls back to heuristic when the model is unavailable", async () => {
    const s = svc({});
    await s.listAgents();
    const summary = await s.summarize("s1");
    expect(summary).toEqual({ sessionId: "s1", text: "do X", fromModel: false });
  });

  it("model summary is used and cached per mtime", async () => {
    let calls = 0;
    const s = svc({
      generator: {
        generate: async () => null,
        isAvailable: () => true,
        summarize: async () => { calls++; return "doing X"; },
      },
    });
    await s.listAgents();
    expect(await s.summarize("s1")).toEqual({ sessionId: "s1", text: "doing X", fromModel: true });
    await s.summarize("s1");
    expect(calls).toBe(1); // cached
  });
});
