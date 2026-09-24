import { injectable, unmanaged } from "@theia/core/shared/inversify";
import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  DECISION_MODEL_REPOS,
  DEFAULT_DECISION_MODEL,
  type Decision,
  type DecisionAnswer,
  type DecisionModel,
  type DecisionModelStatus,
  type DecisionQuestion,
  type SpexrDecisionService,
} from "../../common/decision-protocol.js";
import { resolveDecisionWorkerPath, resolveModelsDir } from "../search/models-dir.js";
import { resolveNodeBinary } from "../search/worker-description-generator.js";
import { downloadModel, userModelsDir } from "./model-download.js";
import { averageChoices, CHOICE_ROTATIONS, rotations } from "./option-order.js";

/** host → worker */
export interface DecisionWorkerRequest {
  readonly id: number;
  readonly state: string;
  readonly question: DecisionQuestion;
}

/** worker → host */
export type DecisionWorkerResponse =
  | { readonly id: number; readonly type: "done"; readonly answer: DecisionAnswer }
  | { readonly id: number; readonly type: "error"; readonly message: string };

export interface DecisionWorkerLike {
  postMessage(msg: DecisionWorkerRequest): void;
  on(event: "message", cb: (msg: DecisionWorkerResponse) => void): void;
  on(event: "error" | "exit", cb: (arg: unknown) => void): void;
  terminate(): unknown;
}

/**
 * Longest a decision may take. It covers loading the model on the first
 * decision (kev-4b loads from disk in about 9–11 s) with room to spare; a
 * caller waiting longer is better served by deciding itself.
 */
const DECIDE_TIMEOUT_MS = 30_000;

/** Wait after start before downloading missing weights, so startup is not contended. */
const DOWNLOAD_DELAY_MS = 20_000;

/** Env var naming the repo the worker loads. */
export const DECISION_REPO_ENV = "SPEXR_DECISION_REPO";

/** Env var that, set to `off`, disables downloading missing weights (E2E runs, offline setups). */
export const MODEL_DOWNLOAD_ENV = "SPEXR_MODEL_DOWNLOAD";

function defaultWorkerFactory(repo: string, modelsDir: string): DecisionWorkerLike {
  const node = resolveNodeBinary();
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXR_MODELS_DIR: modelsDir, [DECISION_REPO_ENV]: repo };
  if (node) delete env.ELECTRON_RUN_AS_NODE;
  else env.ELECTRON_RUN_AS_NODE = "1";
  const child = fork(resolveDecisionWorkerPath(), [], {
    ...(node ? { execPath: node } : {}),
    env,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  return {
    postMessage: (msg) => void child.send(msg),
    on: (event: "message" | "error" | "exit", cb: (arg: never) => void) =>
      void child.on(event, cb as (arg: unknown) => void),
    terminate: () => child.kill(),
  } as DecisionWorkerLike;
}

/**
 * The models directory holding a repo's weights: the ones vendored with the
 * app first, then the ones downloaded on first run. Undefined when neither
 * has them. SPEXR_MODELS_DIR, when set, is the only place looked at.
 */
function locateWeights(repo: string): string | undefined {
  const dirs = process.env.SPEXR_MODELS_DIR ? [resolveModelsDir()] : [resolveModelsDir(), userModelsDir()];
  return dirs.find((dir) => existsSync(join(dir, repo, "config.json")));
}

export interface DecisionServiceDeps {
  readonly factory: (repo: string, modelsDir: string) => DecisionWorkerLike;
  readonly locate: (repo: string) => string | undefined;
  readonly download: (
    repo: string,
    onProgress: (received: number, total: number) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly downloads: boolean;
  readonly downloadDelayMs: number;
  readonly timeoutMs: number;
}

const DEFAULT_DEPS: DecisionServiceDeps = {
  factory: defaultWorkerFactory,
  locate: locateWeights,
  download: (repo, onProgress, signal) => downloadModel(repo, userModelsDir(), { onProgress, signal }),
  downloads: process.env[MODEL_DOWNLOAD_ENV] !== "off",
  downloadDelayMs: DOWNLOAD_DELAY_MS,
  timeoutMs: DECIDE_TIMEOUT_MS,
};

interface DownloadJob {
  readonly repo: string;
  readonly abort: AbortController;
  state: "waiting" | "downloading" | "failed";
  received: number;
  total: number;
}

/**
 * Typed decisions on a local Jev-shaped model (spec 0017). The model runs in
 * its own child process, like the generation worker: its inference is a
 * synchronous native call of up to a second, which in the backend would stall
 * every RPC and the wall. The process is started on the first decision and
 * restarted when the model preference changes.
 *
 * Weights missing on disk are downloaded in the background shortly after the
 * frontend first reports the model, so a release needs no multi-GB installer.
 * Until they land, decide() returns undefined. A failed download is retried
 * on the next start or model change, never in a loop.
 */
@injectable()
export class SpexrDecisionBackendService implements SpexrDecisionService {
  private model: DecisionModel = DEFAULT_DECISION_MODEL;
  private worker: DecisionWorkerLike | undefined;
  private seq = 0;
  private readonly pending = new Map<number, (d: DecisionAnswer | undefined) => void>();
  private download: DownloadJob | undefined;
  private readonly deps: DecisionServiceDeps;

  // @unmanaged(): inversify must not try to inject this test seam.
  constructor(@unmanaged() deps: Partial<DecisionServiceDeps> = {}) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  /** Also the frontend's call on start: it schedules the download of missing weights. */
  async setModel(model: DecisionModel): Promise<void> {
    if (model !== this.model) {
      this.model = model;
      this.stop();
    }
    this.ensureWeights();
  }

  async status(): Promise<DecisionModelStatus> {
    const model = this.model;
    if (model === "off") return { model, state: "off" };
    const repo = DECISION_MODEL_REPOS[model];
    if (this.deps.locate(repo)) return { model, state: "ready" };
    const job = this.download?.repo === repo ? this.download : undefined;
    if (!job) return { model, state: "missing" };
    return { model, state: job.state, received: job.received, total: job.total };
  }

  /**
   * A choice question is asked in a few rotations of its options and the
   * probabilities averaged: the model favours options by position, so a
   * single ordering would make the answer depend on how the caller listed
   * them (see option-order.ts).
   */
  async decide(state: string, question: DecisionQuestion): Promise<Decision | undefined> {
    const model = this.model;
    if (model === "off") return undefined;
    const repo = DECISION_MODEL_REPOS[model];
    const dir = this.deps.locate(repo);
    if (!dir) return undefined;
    const text = state.trim();
    if (question.type !== "choice" || question.options.length < 2) {
      const answer = await this.ask(repo, dir, text, question);
      return answer ? ({ ...answer, model } as Decision) : undefined;
    }
    const distributions: Readonly<Record<string, number>>[] = [];
    for (const order of rotations(question.options, CHOICE_ROTATIONS)) {
      const answer = await this.ask(repo, dir, text, { ...question, options: order });
      if (answer?.type !== "choice") return undefined;
      distributions.push(answer.probabilities);
    }
    return { type: "choice", ...averageChoices(question.options, distributions), model };
  }

  /** One round trip to the worker; undefined on error, crash or timeout. */
  private async ask(
    repo: string,
    dir: string,
    state: string,
    question: DecisionQuestion,
  ): Promise<DecisionAnswer | undefined> {
    const worker = (this.worker ??= this.start(repo, dir));
    const id = ++this.seq;
    const answer = await new Promise<DecisionAnswer | undefined>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(undefined);
      }, this.deps.timeoutMs);
      this.pending.set(id, (d) => {
        clearTimeout(timer);
        resolve(d);
      });
      worker.postMessage({ id, state, question });
    });
    return answer;
  }

  private start(repo: string, dir: string): DecisionWorkerLike {
    const worker = this.deps.factory(repo, dir);
    worker.on("message", (msg) => {
      const settle = this.pending.get(msg.id);
      if (!settle) return;
      this.pending.delete(msg.id);
      if (msg.type === "error") console.error(`[spexr decisions] ${msg.message}`);
      settle(msg.type === "done" ? msg.answer : undefined);
    });
    const onGone = (): void => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      this.settleAll();
    };
    worker.on("exit", onGone);
    worker.on("error", onGone);
    return worker;
  }

  private stop(): void {
    const worker = this.worker;
    this.worker = undefined;
    worker?.terminate();
    this.settleAll();
  }

  /** Schedules the current model's download when its weights are missing; cancels one no longer needed. */
  private ensureWeights(): void {
    const model = this.model;
    const repo = model === "off" ? undefined : DECISION_MODEL_REPOS[model];
    const needed = repo !== undefined && !this.deps.locate(repo);
    if (needed && this.download?.repo === repo) return;
    this.download?.abort.abort();
    this.download = undefined;
    if (!needed || !this.deps.downloads) return;
    const job: DownloadJob = { repo, abort: new AbortController(), state: "waiting", received: 0, total: 0 };
    this.download = job;
    const timer = setTimeout(() => void this.runDownload(job), this.deps.downloadDelayMs);
    timer.unref?.();
    job.abort.signal.addEventListener("abort", () => clearTimeout(timer));
  }

  private async runDownload(job: DownloadJob): Promise<void> {
    job.state = "downloading";
    console.info(`[spexr decisions] downloading ${job.repo}`);
    try {
      await this.deps.download(
        job.repo,
        (received, total) => {
          job.received = received;
          job.total = total;
        },
        job.abort.signal,
      );
      if (this.download === job) this.download = undefined;
      console.info(`[spexr decisions] ${job.repo} downloaded`);
    } catch (err) {
      if (job.abort.signal.aborted) return;
      job.state = "failed";
      console.error(
        `[spexr decisions] could not download ${job.repo}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private settleAll(): void {
    for (const settle of this.pending.values()) settle(undefined);
    this.pending.clear();
  }
}
