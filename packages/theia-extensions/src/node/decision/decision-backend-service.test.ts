import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionQuestion } from "../../common/decision-protocol.js";
import {
  SpexrDecisionBackendService,
  type DecisionWorkerLike,
  type DecisionWorkerRequest,
  type DecisionWorkerResponse,
} from "./decision-backend-service.js";

const Q: DecisionQuestion = { type: "choice", instructions: "Which?", options: ["a", "b"] };

/** A worker whose replies the test drives; records requests and the models it was started with. */
function fakeWorkers() {
  const started: string[] = [];
  const workers: { requests: DecisionWorkerRequest[]; reply: (r: DecisionWorkerResponse) => void; killed: boolean }[] = [];
  const factory = (repo: string): DecisionWorkerLike => {
    started.push(repo);
    let onMessage: (r: DecisionWorkerResponse) => void = () => {};
    let onExit: (arg: unknown) => void = () => {};
    const w = { requests: [] as DecisionWorkerRequest[], reply: (r: DecisionWorkerResponse) => onMessage(r), killed: false, exit: () => onExit(1) };
    workers.push(w);
    return {
      postMessage: (msg) => void w.requests.push(msg),
      on: (event: string, cb: (arg: never) => void) => {
        if (event === "message") onMessage = cb as never;
        if (event === "exit") onExit = cb as never;
      },
      terminate: () => {
        w.killed = true;
      },
    } as DecisionWorkerLike;
  };
  return { started, workers, factory };
}

const answer = { type: "choice", choice: "a", confidence: 0.8, probabilities: { a: 0.8, b: 0.2 } } as const;

afterEach(() => vi.useRealTimers());

describe("SpexrDecisionBackendService", () => {
  it("answers through the worker of the configured model, tagging the model", async () => {
    const { started, workers, factory } = fakeWorkers();
    const svc = new SpexrDecisionBackendService(factory, () => true);
    const pending = svc.decide("state", Q);
    expect(started).toEqual(["onnx-community/kev-4b-ONNX"]);
    const req = workers[0]!.requests[0]!;
    expect(req).toMatchObject({ state: "state", question: Q });
    workers[0]!.reply({ id: req.id, type: "done", answer });
    expect(await pending).toEqual({ ...answer, model: "kev-4b" });
  });

  it("decides nothing when switched off, without starting a worker", async () => {
    const { started, factory } = fakeWorkers();
    const svc = new SpexrDecisionBackendService(factory, () => true);
    await svc.setModel("off");
    expect(await svc.decide("state", Q)).toBeUndefined();
    expect(started).toEqual([]);
  });

  it("decides nothing while the model's weights are not on disk", async () => {
    const { started, factory } = fakeWorkers();
    const svc = new SpexrDecisionBackendService(factory, () => false);
    expect(await svc.decide("state", Q)).toBeUndefined();
    expect(started).toEqual([]);
  });

  it("restarts on the new model when the preference changes", async () => {
    const { started, workers, factory } = fakeWorkers();
    const svc = new SpexrDecisionBackendService(factory, () => true);
    void svc.decide("state", Q);
    await svc.setModel("kev-0.6b");
    expect(workers[0]!.killed).toBe(true);
    const pending = svc.decide("state", Q);
    expect(started).toEqual(["onnx-community/kev-4b-ONNX", "onnx-community/kev-0.6b-ONNX"]);
    workers[1]!.reply({ id: workers[1]!.requests[0]!.id, type: "done", answer });
    expect((await pending)?.model).toBe("kev-0.6b");
  });

  it("gives up on a decision that takes too long", async () => {
    vi.useFakeTimers();
    const { factory } = fakeWorkers();
    const svc = new SpexrDecisionBackendService(factory, () => true, 1000);
    const pending = svc.decide("state", Q);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBeUndefined();
  });

  it("turns a worker error or crash into no decision", async () => {
    const { workers, factory } = fakeWorkers();
    const svc = new SpexrDecisionBackendService(factory, () => true);
    const failed = svc.decide("state", Q);
    workers[0]!.reply({ id: workers[0]!.requests[0]!.id, type: "error", message: "boom" });
    expect(await failed).toBeUndefined();

    const crashed = svc.decide("state", Q);
    (workers[0] as unknown as { exit: () => void }).exit();
    expect(await crashed).toBeUndefined();
  });
});
