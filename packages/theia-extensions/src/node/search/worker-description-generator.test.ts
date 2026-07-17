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

  it("becomes unavailable and resolves pending to null on crash", async () => {
    const fake = new FakeWorker();
    const gen = new WorkerDescriptionGenerator(() => fake);
    const p = gen.generate("a.ts", "x");
    fake.crash();
    expect(await p).toBeNull();
    expect(gen.isAvailable()).toBe(false);
    expect(await gen.generate("b.ts", "y")).toBeNull();
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

  it("summarize posts a summary request and resolves with worker text", async () => {
    const fake = new FakeWorker();
    const gen = new WorkerDescriptionGenerator(() => fake);
    const p = gen.summarize("user: fix auth");
    expect(fake.requests[0]!.kind).toBe("summary");
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
