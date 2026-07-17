import { injectable, unmanaged } from "@theia/core/shared/inversify";
import { Worker } from "node:worker_threads";
import { resolveModelsDir, resolveWorkerPath } from "./models-dir.js";
import type {
  DescriptionGenerator,
  WorkerRequest,
  WorkerResponse,
} from "./description-format.js";

/** Minimal surface of a worker thread used by the host (for test fakes). */
export interface WorkerLike {
  postMessage(msg: WorkerRequest): void;
  on(event: "message", cb: (msg: WorkerResponse) => void): void;
  on(event: "error" | "exit", cb: (arg: unknown) => void): void;
  terminate(): unknown;
}

function defaultWorkerFactory(): WorkerLike {
  return new Worker(resolveWorkerPath(), {
    workerData: { modelsDir: resolveModelsDir() },
  }) as unknown as WorkerLike;
}

interface Pending {
  resolve: (value: string | null) => void;
}

/**
 * Drives description generation in a worker thread. Spawns the worker lazily
 * on first use and degrades to null permanently if the worker errors or exits.
 */
@injectable()
export class WorkerDescriptionGenerator implements DescriptionGenerator {
  private worker: WorkerLike | undefined;
  private failed = false;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

  // @unmanaged(): inversify must not try to inject this defaulted factory param.
  constructor(@unmanaged() private readonly factory: () => WorkerLike = defaultWorkerFactory) {}

  isAvailable(): boolean {
    return !this.failed;
  }

  generate(relPath: string, content: string): Promise<string | null> {
    const worker = this.ensureWorker();
    if (!worker) return Promise.resolve(null);
    const id = ++this.seq;
    return new Promise<string | null>((resolve) => {
      this.pending.set(id, { resolve });
      worker.postMessage({ id, relPath, content });
    });
  }

  summarize(turnsText: string): Promise<string | null> {
    const worker = this.ensureWorker();
    if (!worker) return Promise.resolve(null);
    const id = ++this.seq;
    return new Promise<string | null>((resolve) => {
      this.pending.set(id, { resolve });
      worker.postMessage({ id, kind: "summary", relPath: "", content: turnsText });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
  }

  private ensureWorker(): WorkerLike | undefined {
    if (this.failed) return undefined;
    if (!this.worker) {
      try {
        const worker = this.factory();
        worker.on("message", (msg: WorkerResponse) => this.onMessage(msg));
        worker.on("error", () => this.fail());
        worker.on("exit", () => this.fail());
        this.worker = worker;
      } catch {
        this.fail();
        return undefined;
      }
    }
    return this.worker;
  }

  private onMessage(msg: WorkerResponse): void {
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    entry.resolve(msg.type === "done" ? msg.text : null);
  }

  private fail(): void {
    this.failed = true;
    for (const entry of this.pending.values()) entry.resolve(null);
    this.pending.clear();
    this.worker = undefined;
  }
}
