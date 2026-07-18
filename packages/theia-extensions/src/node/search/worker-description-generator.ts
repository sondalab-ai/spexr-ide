import { injectable, unmanaged } from "@theia/core/shared/inversify";
import { fork } from "node:child_process";
import { resolveModelsDir, resolveWorkerPath } from "./models-dir.js";
import type {
  DescriptionGenerator,
  WorkerRequest,
  WorkerResponse,
} from "./description-format.js";

/** Minimal surface of the model worker used by the host (for test fakes). */
export interface WorkerLike {
  postMessage(msg: WorkerRequest): void;
  on(event: "message", cb: (msg: WorkerResponse) => void): void;
  on(event: "error" | "exit", cb: (arg: unknown) => void): void;
  terminate(): unknown;
}

/**
 * Fork the model worker as its own OS process (not a worker_thread) so its native
 * onnxruntime work never touches the backend's process — see description-worker's
 * header. `ELECTRON_RUN_AS_NODE` makes the Electron binary run the script as
 * plain Node (the same pattern Theia uses for its forked backends); the models
 * dir is passed by env since forks have no `workerData`.
 */
function defaultWorkerFactory(): WorkerLike {
  const child = fork(resolveWorkerPath(), [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SPEXR_MODELS_DIR: resolveModelsDir() },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  return {
    postMessage: (msg) => void child.send(msg),
    on: (event: "message" | "error" | "exit", cb: (arg: never) => void) =>
      void child.on(event, cb as (arg: unknown) => void),
    terminate: () => child.kill(),
  } as WorkerLike;
}

interface Pending {
  resolve: (value: string | null) => void;
}

/** Give up on the worker only after this many consecutive crashes. */
const MAX_CONSECUTIVE_CRASHES = 3;

/**
 * Drives description generation in a worker thread. Spawns the worker lazily on
 * first use. A worker crash (error/exit) rejects in-flight work and tears the
 * worker down, but the next request respawns it — one crash no longer disables
 * generation forever. Only after {@link MAX_CONSECUTIVE_CRASHES} back-to-back
 * crashes (with no successful result between) does it degrade to null. Crash
 * reasons are logged so the cause (e.g. OOM) is visible in the backend output.
 */
@injectable()
export class WorkerDescriptionGenerator implements DescriptionGenerator {
  private worker: WorkerLike | undefined;
  private failed = false;
  private crashes = 0;
  private disposing = false;
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
    this.disposing = true;
    this.worker?.terminate();
    this.worker = undefined;
  }

  private ensureWorker(): WorkerLike | undefined {
    if (this.failed) return undefined;
    if (!this.worker) {
      try {
        const worker = this.factory();
        worker.on("message", (msg: WorkerResponse) => this.onMessage(msg));
        worker.on("error", (err) => this.onCrash("error", err));
        worker.on("exit", (code) => this.onCrash("exit", code));
        this.worker = worker;
        console.error("[darkfactory] description worker started");
      } catch (err) {
        console.error("[darkfactory] description worker failed to spawn:", err);
        this.fail();
        return undefined;
      }
    }
    return this.worker;
  }

  private onMessage(msg: WorkerResponse): void {
    if (msg.type === "done") this.crashes = 0; // a real result clears the crash streak
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    entry.resolve(msg.type === "done" ? msg.text : null);
  }

  /**
   * Handle a worker `error`/`exit`. `error` fires first and nulls the worker, so
   * the following `exit` is ignored; a self-initiated `terminate()` is ignored too.
   * In-flight work resolves null and the worker is dropped so the next request
   * respawns it — unless the crash streak hits the cap.
   */
  private onCrash(kind: "error" | "exit", info: unknown): void {
    if (this.disposing) return; // our own terminate()
    if (!this.worker && kind === "exit") return; // already handled via the preceding "error"
    this.crashes++;
    console.error(
      `[darkfactory] description worker ${kind} (crash ${this.crashes}/${MAX_CONSECUTIVE_CRASHES}):`,
      info,
    );
    for (const entry of this.pending.values()) entry.resolve(null);
    this.pending.clear();
    this.worker = undefined;
    if (this.crashes >= MAX_CONSECUTIVE_CRASHES) {
      console.error("[darkfactory] too many description-worker crashes; disabling local model");
      this.failed = true;
    }
  }

  private fail(): void {
    this.failed = true;
    for (const entry of this.pending.values()) entry.resolve(null);
    this.pending.clear();
    this.worker = undefined;
  }
}
