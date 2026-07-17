import { describe, expect, it } from "vitest";
import { DescriptionJob, type DescriptionJobDeps } from "./description-job.js";
import { VectorIndex, type IndexRecord } from "./vector-index.js";
import { DescriptionsStore } from "./descriptions-store.js";
import type { DescriptionGenerator } from "./description-format.js";
import type { DescriptionJobStatus } from "../../common/search-protocol.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rec = (path: string, category = "other"): IndexRecord => ({
  path, category, description: "static",
  vector: new Float32Array([1]), mtimeMs: 0, hash: "h", snippet: "",
});

/** Fake local model: records calls, returns `desc:<path>`; can trip a hook mid-call. */
class FakeGenerator implements DescriptionGenerator {
  available = true;
  calls: string[] = [];
  beforeResolve?: () => void;

  isAvailable(): boolean { return this.available; }

  async generate(relPath: string, _content: string): Promise<string | null> {
    this.calls.push(relPath);
    this.beforeResolve?.();
    return `desc:${relPath}`;
  }

  async summarize(): Promise<string | null> { return null; }
}

interface JobEnv {
  d: DescriptionJobDeps;
  statuses: DescriptionJobStatus[];
  state: { markdowns: number };
  store: DescriptionsStore;
  root: string;
}

async function makeEnv(
  index: VectorIndex,
  generator: DescriptionGenerator,
  over: Partial<DescriptionJobDeps> = {},
): Promise<JobEnv> {
  const root = await mkdtemp(join(tmpdir(), "djob-"));
  const store = new DescriptionsStore(root);
  const statuses: DescriptionJobStatus[] = [];
  const state = { markdowns: 0 };
  const d: DescriptionJobDeps = {
    records: () => index.allRecords(),
    readContent: async (rel) => `content of ${rel}`,
    generator,
    store,
    writeMarkdown: async () => { state.markdowns++; },
    emit: (s) => statuses.push({ ...s }),
    ...over,
  };
  return { d, statuses, state, store, root };
}

describe("DescriptionJob", () => {
  it("describes only records missing from the store by default", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    idx.upsert(rec("b.ts"));
    idx.upsert(rec("c.ts"));
    const generator = new FakeGenerator();
    const env = await makeEnv(idx, generator);

    // Pre-seed b.ts in the store so it is skipped.
    await env.store.merge(new Map([["b.ts", { description: "already", category: "other" }]]));

    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });

    expect(generator.calls.sort()).toEqual(["a.ts", "c.ts"]);
    expect(env.store.get("a.ts")).toBe("desc:a.ts");
    expect(env.store.get("b.ts")).toBe("already"); // untouched
    expect(job.status).toMatchObject({ state: "complete", done: 2, total: 2 });

    await rm(env.root, { recursive: true, force: true });
  });

  it("skips files that are not worth mapping (vendored / fixtures)", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("src/app.ts"));
    idx.upsert(rec("node_modules/dep/index.js"));
    idx.upsert(rec("src/__fixtures__/sample.json"));
    const generator = new FakeGenerator();
    const env = await makeEnv(idx, generator);

    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });

    expect(generator.calls).toEqual(["src/app.ts"]);
    expect(job.status).toMatchObject({ state: "complete", total: 1 });

    await rm(env.root, { recursive: true, force: true });
  });

  it("regenerate=true reprocesses every record", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    const generator = new FakeGenerator();
    const env = await makeEnv(idx, generator);
    await env.store.merge(new Map([["a.ts", { description: "old", category: "other" }]]));

    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: true });
    expect(env.store.get("a.ts")).toBe("desc:a.ts");

    await rm(env.root, { recursive: true, force: true });
  });

  it("persists descriptions and writes the markdown once on completion", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    idx.upsert(rec("b.ts"));
    const generator = new FakeGenerator();
    const env = await makeEnv(idx, generator);

    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });

    expect(env.store.get("a.ts")).toBe("desc:a.ts");
    expect(env.store.get("b.ts")).toBe("desc:b.ts");
    expect(env.state.markdowns).toBe(1);
    expect(job.status.state).toBe("complete");

    await rm(env.root, { recursive: true, force: true });
  });

  it("stores the category from the index record", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("front.tsx", "frontend"));
    const generator = new FakeGenerator();
    const env = await makeEnv(idx, generator);

    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });

    expect(env.store.entries().get("front.tsx")?.category).toBe("frontend");

    await rm(env.root, { recursive: true, force: true });
  });

  it("pauses after the current file and resumes the rest", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    idx.upsert(rec("b.ts"));
    idx.upsert(rec("c.ts"));
    const generator = new FakeGenerator();
    const env = await makeEnv(idx, generator);

    const job = new DescriptionJob(env.d);
    // Pause during the first file's generation; it takes effect before the next file.
    generator.beforeResolve = () => { generator.beforeResolve = undefined; job.pause(); };
    await job.start({ regenerate: false });

    expect(job.status.state).toBe("paused");
    expect(job.status.done).toBe(1);
    expect(env.store.get("a.ts")).toBe("desc:a.ts"); // flushed on pause

    await job.resume();
    expect(job.status).toMatchObject({ state: "complete", done: 3, total: 3 });
    expect(env.store.get("c.ts")).toBe("desc:c.ts");

    const distinctStates = env.statuses
      .map((s) => s.state)
      .filter((s, i, arr) => i === 0 || s !== arr[i - 1]);
    expect(distinctStates).toEqual(["running", "paused", "running", "complete"]);

    await rm(env.root, { recursive: true, force: true });
  });

  it("ends in error when the model is unavailable", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    const generator = new FakeGenerator();
    generator.available = false;
    const env = await makeEnv(idx, generator);

    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });
    expect(job.status.state).toBe("error");
    expect(job.status.message).toContain("Description model not available");
    expect(env.state.markdowns).toBe(0);

    await rm(env.root, { recursive: true, force: true });
  });

  it("transitions to error when writeMarkdown throws, and allows restart", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    const generator = new FakeGenerator();
    let mdCalls = 0;
    const env = await makeEnv(idx, generator, {
      writeMarkdown: async () => {
        if (++mdCalls === 1) throw new Error("write failed");
      },
    });

    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });
    expect(job.status.state).toBe("error");
    expect(job.status.message).toContain("write failed");

    // Job is not stuck in "running" — start must be allowed to proceed.
    await job.start({ regenerate: true });
    expect(job.status.state).toBe("complete");

    await rm(env.root, { recursive: true, force: true });
  });
});
