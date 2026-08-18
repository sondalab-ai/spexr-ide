import { describe, expect, it, vi } from "vitest";
import { Container } from "@theia/core/shared/inversify";
import { WorkerDescriptionGenerator, type WorkerLike } from "./worker-description-generator.js";
import { DescriptionGeneratorToken, type WorkerRequest, type WorkerResponse } from "./description-format.js";

/** Controllable fake worker: records requests, lets the test push responses. */
class FakeWorker implements WorkerLike {
  requests: WorkerRequest[] = [];
  private messageCb?: (m: WorkerResponse) => void;
  private errorCb?: (e: unknown) => void;
  private exitCb?: (c: unknown) => void;
  terminated = false;

  postMessage(msg: WorkerRequest): void { this.requests.push(msg); }
  on(event: "message" | "error" | "exit", cb: (arg: never) => void): void {
    if (event === "message") this.messageCb = cb as (m: WorkerResponse) => void;
    else if (event === "error") this.errorCb = cb;
    else this.exitCb = cb;
  }
  terminate(): void { this.terminated = true; }

  emit(msg: WorkerResponse): void { this.messageCb?.(msg); }
  crash(): void { this.errorCb?.(new Error("worker crashed")); }
  exit(): void { this.exitCb?.(1); }
}

describe("WorkerDescriptionGenerator", () => {
  it("resolves with the text from the done message", async () => {
    const fake = new FakeWorker();
    const gen = new WorkerDescriptionGenerator(() => fake);
    const p = gen.generate("a.ts", "code");
    fake.emit({ id: fake.requests[0]!.id, type: "done", text: "Handles auth." });
    expect(await p).toBe("Handles auth.");
  });

  it("resolves null on an error response", async () => {
    const fake = new FakeWorker();
    const gen = new WorkerDescriptionGenerator(() => fake);
    const p = gen.generate("a.ts", "x");
    fake.emit({ id: fake.requests[0]!.id, type: "error" });
    expect(await p).toBeNull();
  });

  it("resolves pending to null on a crash but stays available and respawns", async () => {
    const factory = vi.fn(() => new FakeWorker());
    const gen = new WorkerDescriptionGenerator(factory);
    const p = gen.generate("a.ts", "x");
    (factory.mock.results[0]!.value as FakeWorker).crash();
    expect(await p).toBeNull();
    expect(gen.isAvailable()).toBe(true); // resilient: one crash does not disable
    const p2 = gen.generate("b.ts", "y");
    expect(factory).toHaveBeenCalledTimes(2); // respawned a fresh worker
    const second = factory.mock.results[1]!.value as FakeWorker;
    second.emit({ id: second.requests[0]!.id, type: "done", text: "ok" });
    expect(await p2).toBe("ok");
  });

  it("disables the model after 3 consecutive worker crashes", async () => {
    const factory = vi.fn(() => new FakeWorker());
    const gen = new WorkerDescriptionGenerator(factory);
    for (let i = 0; i < 3; i++) {
      const p = gen.generate("a.ts", "x");
      (factory.mock.results[i]!.value as FakeWorker).crash();
      expect(await p).toBeNull();
    }
    expect(gen.isAvailable()).toBe(false);
    expect(await gen.generate("b.ts", "y")).toBeNull();
  });

  it("a successful result resets the crash streak", async () => {
    const factory = vi.fn(() => new FakeWorker());
    const gen = new WorkerDescriptionGenerator(factory);
    const current = () => factory.mock.results.at(-1)!.value as FakeWorker;
    for (let i = 0; i < 2; i++) {
      const p = gen.generate("a.ts", "x");
      current().crash();
      expect(await p).toBeNull();
    }
    const ok = gen.generate("b.ts", "y");
    const w = current();
    w.emit({ id: w.requests[0]!.id, type: "done", text: "good" });
    expect(await ok).toBe("good");
    for (let i = 0; i < 2; i++) {
      const p = gen.generate("a.ts", "x");
      current().crash();
      expect(await p).toBeNull();
    }
    expect(gen.isAvailable()).toBe(true); // streak was reset by the success
  });

  it("returns null without spawning when the factory throws", async () => {
    const gen = new WorkerDescriptionGenerator(() => { throw new Error("spawn failed"); });
    expect(await gen.generate("a.ts", "x")).toBeNull();
    expect(gen.isAvailable()).toBe(false);
  });

  it("spawns the worker only once across calls", async () => {
    const fake = new FakeWorker();
    const factory = vi.fn(() => fake);
    const gen = new WorkerDescriptionGenerator(factory);
    const p1 = gen.generate("a.ts", "x");
    const p2 = gen.generate("b.ts", "y");
    fake.emit({ id: fake.requests[0]!.id, type: "done", text: "one" });
    fake.emit({ id: fake.requests[1]!.id, type: "done", text: "two" });
    expect(await p1).toBe("one");
    expect(await p2).toBe("two");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("summarize posts the request under its kind and resolves with worker text", async () => {
    const fake = new FakeWorker();
    const gen = new WorkerDescriptionGenerator(() => fake);
    const p = gen.summarize("Most recent activity:\nfix auth", "now");
    expect(fake.requests[0]!.kind).toBe("now");
    expect(fake.requests[0]!.content).toContain("fix auth");
    fake.emit({ id: fake.requests[0]!.id, type: "done", text: "fixing auth" });
    expect(await p).toBe("fixing auth");
  });

  it("resolves via inversify DI without binding the unmanaged factory", () => {
    const container = new Container();
    container.bind(DescriptionGeneratorToken).to(WorkerDescriptionGenerator);
    const gen = container.get(DescriptionGeneratorToken);
    expect(gen).toBeInstanceOf(WorkerDescriptionGenerator);
  });
});

describe("buildWorkerEnv", () => {
  it("strips inherited ELECTRON_RUN_AS_NODE for a genuine-Node child (regression: it forced the CPU provider)", async () => {
    const { buildWorkerEnv } = await import("./worker-description-generator.js");
    const env = buildWorkerEnv({ ELECTRON_RUN_AS_NODE: "1", HOME: "/h" }, true);
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.HOME).toBe("/h");
    expect(env.SPEXR_MODELS_DIR).toBeTruthy();
  });

  it("sets ELECTRON_RUN_AS_NODE when the child must run as Electron-as-node", async () => {
    const { buildWorkerEnv } = await import("./worker-description-generator.js");
    const env = buildWorkerEnv({}, false);
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
  });
});
