import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionQuestion } from "../../common/decision-protocol.js";
import {
  SpexrDecisionBackendService,
  type DecisionWorkerLike,
  type DecisionWorkerRequest,
  type DecisionWorkerResponse,
} from "./decision-backend-service.js";

const Q: DecisionQuestion = { type: "noul", instructions: "It holds." };
const CHOICE: DecisionQuestion = { type: "choice", instructions: "Which?", options: ["a", "b", "c"] };

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

const answer = { type: "noul", answer: true, probability: 0.8, confidence: 0.8 } as const;

afterEach(() => vi.useRealTimers());

describe("SpexrDecisionBackendService", () => {
  it("answers through the worker of the configured model, tagging the model", async () => {
    const { started, workers, factory } = fakeWorkers();
    const svc = new SpexrDecisionBackendService({ factory, locate: () => "/models", downloads: false });
    const pending = svc.decide("  state\n", Q);
    expect(started).toEqual(["onnx-community/kev-4b-ONNX"]);
    const req = workers[0]!.requests[0]!;
    expect(req).toMatchObject({ state: "state", question: Q });
    workers[0]!.reply({ id: req.id, type: "done", answer });
    expect(await pending).toEqual({ ...answer, model: "kev-4b" });
  });

  it("decides nothing when switched off, without starting a worker", async () => {
    const { started, factory } = fakeWorkers();
    const svc = new SpexrDecisionBackendService({ factory, locate: () => "/models", downloads: false });
    await svc.setModel("off");
    expect(await svc.decide("state", Q)).toBeUndefined();
    expect(started).toEqual([]);
  });

  it("decides nothing while the model's weights are not on disk", async () => {
    const { started, factory } = fakeWorkers();
    const svc = new SpexrDecisionBackendService({ factory, locate: () => undefined, downloads: false });
    expect(await svc.decide("state", Q)).toBeUndefined();
    expect(started).toEqual([]);
  });

  it("restarts on the new model when the preference changes", async () => {
    const { started, workers, factory } = fakeWorkers();
    const svc = new SpexrDecisionBackendService({ factory, locate: () => "/models", downloads: false });
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
    const svc = new SpexrDecisionBackendService({ factory, locate: () => "/models", downloads: false, timeoutMs: 1000 });
    const pending = svc.decide("state", Q);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBeUndefined();
  });

  it("turns a worker error or crash into no decision", async () => {
    const { workers, factory } = fakeWorkers();
    const svc = new SpexrDecisionBackendService({ factory, locate: () => "/models", downloads: false });
    const failed = svc.decide("state", Q);
    workers[0]!.reply({ id: workers[0]!.requests[0]!.id, type: "error", message: "boom" });
    expect(await failed).toBeUndefined();

    const crashed = svc.decide("state", Q);
    (workers[0] as unknown as { exit: () => void }).exit();
    expect(await crashed).toBeUndefined();
  });

  it("asks a choice in several option orders and averages them, so position does not decide", async () => {
    const { workers, factory } = fakeWorkers();
    const svc = new SpexrDecisionBackendService({ factory, locate: () => "/models", downloads: false });
    const pending = svc.decide("state", CHOICE);
    // The model favours whatever comes first; averaged, "b" wins.
    const firstWins = (options: readonly string[]) =>
      Object.fromEntries(options.map((o, i) => [o, i === 0 ? 0.5 : o === "b" ? 0.4 : 0.1]));
    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => expect(workers[0]!.requests.length).toBe(i + 1));
      const req = workers[0]!.requests[i]!;
      const options = (req.question as { options: readonly string[] }).options;
      const probabilities = firstWins(options);
      workers[0]!.reply({
        id: req.id,
        type: "done",
        answer: { type: "choice", choice: options[0]!, confidence: 0.5, probabilities },
      });
    }
    const orders = workers[0]!.requests.map((r) => (r.question as { options: readonly string[] }).options[0]);
    expect(orders).toEqual(["a", "b", "c"]);
    const d = await pending;
    expect(d).toMatchObject({ type: "choice", choice: "b", model: "kev-4b" });
  });

  it("drops a decision whose model changed between its option orders, and never mixes models", async () => {
    const { started, workers, factory } = fakeWorkers();
    const svc = new SpexrDecisionBackendService({ factory, locate: () => "/models", downloads: false });
    await svc.setModel("kev-0.6b");
    const pending = svc.decide("state", CHOICE);
    await vi.waitFor(() => expect(workers[0]!.requests.length).toBe(1));
    const req = workers[0]!.requests[0]!;
    await svc.setModel("kev-4b"); // while the first option order is still pending
    workers[0]!.reply({
      id: req.id,
      type: "done",
      answer: { type: "choice", choice: "a", confidence: 0.99, probabilities: { a: 0.99, b: 0.005, c: 0.005 } },
    });
    expect(await pending).toBeUndefined();
    expect(started).toEqual(["onnx-community/kev-0.6b-ONNX"]);

    // The next decision runs on a kev-4b worker, not on a restarted 0.6b one.
    const next = svc.decide("state", Q);
    await vi.waitFor(() => expect(started).toEqual(["onnx-community/kev-0.6b-ONNX", "onnx-community/kev-4b-ONNX"]));
    workers[1]!.reply({ id: workers[1]!.requests[0]!.id, type: "done", answer });
    expect((await next)?.model).toBe("kev-4b");
  });

  describe("missing weights", () => {
    /** A download the test finishes or fails; `landed` makes locate() find the repo afterwards. */
    function fakeDownloads() {
      const landed = new Set<string>();
      const calls: { repo: string; progress: (r: number, t: number) => void; signal: AbortSignal; finish: () => void; fail: () => void }[] = [];
      const download = (repo: string, progress: (r: number, t: number) => void, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          calls.push({
            repo,
            progress,
            signal,
            finish: () => {
              landed.add(repo);
              resolve();
            },
            fail: () => reject(new Error("offline")),
          });
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      const locate = (repo: string) => (landed.has(repo) ? "/user-models" : undefined);
      return { calls, download, locate };
    }

    it("downloads them in the background after a delay, then decides from the downloaded copy", async () => {
      vi.useFakeTimers();
      const { started, workers, factory } = fakeWorkers();
      const dl = fakeDownloads();
      const dirs: string[] = [];
      const svc = new SpexrDecisionBackendService({
        factory: (repo, dir) => (dirs.push(dir), factory(repo)),
        locate: dl.locate,
        download: dl.download,
        downloads: true,
        downloadDelayMs: 1000,
      });
      await svc.setModel("kev-4b");
      expect(await svc.status()).toMatchObject({ state: "waiting" });
      expect(await svc.decide("state", Q)).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1000);
      expect(dl.calls.map((c) => c.repo)).toEqual(["onnx-community/kev-4b-ONNX"]);
      dl.calls[0]!.progress(40, 100);
      expect(await svc.status()).toEqual({ model: "kev-4b", state: "downloading", received: 40, total: 100 });
      dl.calls[0]!.finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(await svc.status()).toEqual({ model: "kev-4b", state: "ready" });

      const pending = svc.decide("state", Q);
      expect(started).toEqual(["onnx-community/kev-4b-ONNX"]);
      expect(dirs).toEqual(["/user-models"]);
      workers[0]!.reply({ id: workers[0]!.requests[0]!.id, type: "done", answer });
      expect((await pending)?.model).toBe("kev-4b");
    });

    it("downloads once however often the model is reported, and not again after a failure", async () => {
      vi.useFakeTimers();
      const { factory } = fakeWorkers();
      const dl = fakeDownloads();
      const svc = new SpexrDecisionBackendService({ factory, locate: dl.locate, download: dl.download, downloads: true, downloadDelayMs: 10 });
      await svc.setModel("kev-4b");
      await svc.setModel("kev-4b");
      await vi.advanceTimersByTimeAsync(10);
      await svc.setModel("kev-4b");
      expect(dl.calls).toHaveLength(1);
      dl.calls[0]!.fail();
      await vi.advanceTimersByTimeAsync(0);
      expect(await svc.status()).toMatchObject({ state: "failed" });
      await svc.setModel("kev-4b");
      await vi.advanceTimersByTimeAsync(10);
      expect(dl.calls).toHaveLength(1);
    });

    it("cancels a download the new model no longer needs, and fetches that model instead", async () => {
      vi.useFakeTimers();
      const { factory } = fakeWorkers();
      const dl = fakeDownloads();
      const svc = new SpexrDecisionBackendService({ factory, locate: dl.locate, download: dl.download, downloads: true, downloadDelayMs: 10 });
      await svc.setModel("kev-4b");
      await vi.advanceTimersByTimeAsync(10);
      await svc.setModel("kev-0.6b");
      expect(dl.calls[0]!.signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(10);
      expect(dl.calls.map((c) => c.repo)).toEqual(["onnx-community/kev-4b-ONNX", "onnx-community/kev-0.6b-ONNX"]);
      expect(await svc.status()).toMatchObject({ model: "kev-0.6b", state: "downloading" });

      await svc.setModel("off");
      expect(dl.calls[1]!.signal.aborted).toBe(true);
      expect(await svc.status()).toEqual({ model: "off", state: "off" });
    });

    it("downloads nothing when downloads are disabled", async () => {
      vi.useFakeTimers();
      const { factory } = fakeWorkers();
      const dl = fakeDownloads();
      const svc = new SpexrDecisionBackendService({ factory, locate: dl.locate, download: dl.download, downloads: false, downloadDelayMs: 10 });
      await svc.setModel("kev-4b");
      await vi.advanceTimersByTimeAsync(100);
      expect(dl.calls).toEqual([]);
      expect(await svc.status()).toEqual({ model: "kev-4b", state: "missing" });
    });
  });
});
