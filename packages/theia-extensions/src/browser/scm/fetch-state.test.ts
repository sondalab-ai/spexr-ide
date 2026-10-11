import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BACKGROUND_FETCH_TIMEOUT_MS, FetchCoordinator, FetchQueue, MANUAL_FETCH_TIMEOUT_MS, withTimeout, type FetchDeps } from "./fetch-state.js";

const own = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

/** A coordinator over fakes: `manual` and `background` are what the two fetches do, `events` counts announcements. */
function make(over: Partial<{ manual: () => Promise<void>; background: () => Promise<void>; timeouts: FetchDeps["timeouts"] }> = {}) {
  const state = { events: 0, manual: async () => undefined, background: async () => undefined, ...over } as { events: number; manual: () => Promise<void>; background: () => Promise<void> };
  const fetches = new FetchCoordinator({
    runManual: () => state.manual(),
    runBackground: () => state.background(),
    changed: () => void state.events++,
    ...(over.timeouts ? { timeouts: over.timeouts } : {}),
  });
  return { fetches, state };
}
const fails = async (): Promise<void> => {
  throw new Error("offline");
};

describe("the fetch outcome (S6d, S3)", () => {
  it("is unknown before any fetch", () => {
    expect(make().fetches.outcome).toBe("unknown");
  });

  it("is ok after a fetch that worked and failed after one that did not, announcing only a change", async () => {
    const { fetches, state } = make();
    await fetches.backgroundFetch();
    expect(fetches.outcome).toBe("ok");
    expect(state.events).toBe(1);
    await fetches.backgroundFetch();
    expect(state.events).toBe(1); // ok again: nothing to say
    state.background = fails;
    await fetches.backgroundFetch();
    expect(fetches.outcome).toBe("failed");
    expect(state.events).toBe(2);
  });

  it("keeps a manual success through background failures: on a remote that needs credentials the unattended fetch fails every tick", async () => {
    const { fetches, state } = make({ background: fails });
    await fetches.backgroundFetch();
    expect(fetches.outcome).toBe("failed");
    await fetches.manualFetch(); // the user's fetch works, with the credentials the prompt got
    expect(fetches.outcome).toBe("ok");
    await fetches.backgroundFetch(); // the next tick fails again
    await fetches.backgroundFetch();
    expect(fetches.outcome).toBe("ok");
    expect(state.events).toBe(2); // failed, then ok: the ticks announced nothing
  });

  it("lets a background success end the override, so a later background failure counts again", async () => {
    const { fetches, state } = make({ background: fails });
    await fetches.manualFetch();
    await fetches.backgroundFetch();
    expect(fetches.outcome).toBe("ok");
    state.background = async () => undefined;
    await fetches.backgroundFetch();
    expect(fetches.outcome).toBe("ok");
    state.background = fails;
    await fetches.backgroundFetch();
    expect(fetches.outcome).toBe("failed");
  });

  it("lets a newer manual attempt decide: a failed one is failed whatever the background said, and a new success is ok again", async () => {
    const { fetches, state } = make();
    await fetches.backgroundFetch();
    state.manual = fails;
    let failure = "";
    try {
      await fetches.manualFetch();
    } catch (err) {
      failure = (err as Error).message;
    }
    expect(failure).toBe("offline");
    expect(fetches.outcome).toBe("failed");
    state.manual = async () => undefined;
    await fetches.manualFetch();
    expect(fetches.outcome).toBe("ok");
  });

  it("is unknown again after a branch switch, and says so once", async () => {
    const { fetches, state } = make();
    await fetches.manualFetch();
    const before = state.events;
    fetches.reset();
    expect(fetches.outcome).toBe("unknown");
    expect(state.events).toBe(before + 1);
    fetches.reset();
    expect(state.events).toBe(before + 1);
  });

  it("counts a fetch that outlasts its limit as failed, a manual one getting the longer limit", async () => {
    expect(MANUAL_FETCH_TIMEOUT_MS).toBeGreaterThan(BACKGROUND_FETCH_TIMEOUT_MS);
    const hang = (): Promise<void> => new Promise(() => undefined);
    const { fetches } = make({ manual: hang, background: hang, timeouts: { manual: 20, background: 10 } });
    await fetches.backgroundFetch();
    expect(fetches.outcome).toBe("failed");
    let failure = "";
    try {
      await fetches.manualFetch();
    } catch (err) {
      failure = (err as Error).message;
    }
    expect(failure).toContain("timed out");
  });

  it("is wired to the provider, with the limits the backend's own are shorter than", () => {
    const provider = own("./git-scm-provider.ts");
    expect(provider).toContain("new FetchCoordinator({");
    expect(provider).toContain("get fetchOutcome(): FetchOutcome");
    expect(provider).toContain("a user-initiated fetch can show");
    const backend = own("../../node/spexr-git-backend-service.ts");
    expect(backend).toContain("const MANUAL_FETCH_TIMEOUT_MS = 120_000;");
    expect(backend).toContain("timeout: { block: MANUAL_FETCH_TIMEOUT_MS }");
    expect(BACKGROUND_FETCH_TIMEOUT_MS).toBeGreaterThan(20_000);
    expect(MANUAL_FETCH_TIMEOUT_MS).toBeGreaterThan(120_000);
  });
});

describe("the fetch queue", () => {
  /** A task that records its start and end, finishing when told. */
  function task(log: string[], name: string) {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => (finish = resolve));
    return { run: async () => { log.push(`${name} start`); await done; log.push(`${name} end`); }, finish };
  }

  it("runs a fetch by hand after a background one, never beside it", async () => {
    const log: string[] = [];
    const queue = new FetchQueue();
    const background = task(log, "background");
    const manual = task(log, "manual");
    const first = queue.enqueue(background.run);
    const second = queue.manual(manual.run);
    await Promise.resolve();
    expect(log).toEqual(["background start"]);
    background.finish();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    manual.finish();
    await second;
    expect(log).toEqual(["background start", "background end", "manual start", "manual end"]);
  });

  it("shares one fetch by hand between callers that arrive while it runs", async () => {
    const queue = new FetchQueue();
    let runs = 0;
    const gate = task([], "m");
    const run = async (): Promise<void> => { runs++; await gate.run(); };
    const a = queue.manual(run);
    const b = queue.manual(run);
    expect(a).toBe(b);
    gate.finish();
    await a;
    await queue.manual(async () => { runs++; });
    expect(runs).toBe(2);
  });

  it("goes on after a failure: a failed fetch does not block the next", async () => {
    const queue = new FetchQueue();
    let failure = "";
    try {
      await queue.enqueue(async () => { throw new Error("offline"); });
    } catch (err) {
      failure = (err as Error).message;
    }
    expect(failure).toBe("offline");
    expect(await queue.enqueue(async () => "ok")).toBe("ok");
  });
});

describe("withTimeout", () => {
  it("passes a result that comes in time, and rejects one that does not", async () => {
    expect(await withTimeout(Promise.resolve(1), 50, "x")).toBe(1);
    let failure = "";
    try {
      await withTimeout(new Promise<number>(() => undefined), 10, "Fetch");
    } catch (err) {
      failure = (err as Error).message;
    }
    expect(failure).toBe("Fetch timed out after 0 s");
  });
});
