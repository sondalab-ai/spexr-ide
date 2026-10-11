import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FetchQueue, FetchState, withTimeout } from "./fetch-state.js";

const own = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

describe("the fetch outcome (S6d, S3)", () => {
  it("announces a change and only a change", () => {
    const state = new FetchState();
    expect(state.isFailed).toBe(false);
    expect(state.record(false)).toBe(false);
    expect(state.record(true)).toBe(true);
    expect(state.isFailed).toBe(true);
    expect(state.record(true)).toBe(false);
    expect(state.record(false)).toBe(true);
    expect(state.isFailed).toBe(false);
  });

  it("is forgotten on a branch switch, and says whether that changed anything", () => {
    const state = new FetchState();
    expect(state.reset()).toBe(false);
    state.record(true);
    expect(state.reset()).toBe(true);
    expect(state.isFailed).toBe(false);
  });

  it("is a separate event from the status's: a fetch's outcome fires only onDidChangeFetchState, and a branch switch resets it", () => {
    const provider = own("./git-scm-provider.ts");
    const note = provider.slice(provider.indexOf("private noteFetch(failed: boolean)"), provider.indexOf("async backgroundFetch()"));
    expect(note).toContain("_onDidChangeFetchStateEmitter.fire()");
    expect(note).not.toContain("_onDidChangeStatusEmitter");
    expect(provider).toContain("this._lastStatus.branch !== status.branch && this.fetchState.reset()");
    expect(own("./git-status-bar-contribution.ts")).toContain("this.registry.onDidChangeFetchState(() => this.renderActive())");
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

  it("runs the provider's fetches through it, with a timeout", () => {
    const provider = own("./git-scm-provider.ts");
    expect(provider).toContain("this.fetches.manual(");
    expect(provider).toContain("this.fetches\n      .enqueue(");
    expect(provider).toContain("withTimeout(this.gitService.fetch(root), FETCH_TIMEOUT_MS");
    expect(provider).toContain("a user-initiated fetch can show");
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
