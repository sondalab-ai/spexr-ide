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
  type DecisionQuestion,
  type SpexrDecisionService,
} from "../../common/decision-protocol.js";
import { resolveDecisionWorkerPath, resolveModelsDir } from "../search/models-dir.js";
import { resolveNodeBinary } from "../search/worker-description-generator.js";
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
 * decision (kev-4b loads from disk in about 8.5 s) with room to spare; a
 * caller waiting longer is better served by deciding itself.
 */
const DECIDE_TIMEOUT_MS = 30_000;

/** Env var naming the repo the worker loads. */
export const DECISION_REPO_ENV = "SPEXR_DECISION_REPO";

function defaultWorkerFactory(repo: string): DecisionWorkerLike {
  const node = resolveNodeBinary();
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXR_MODELS_DIR: resolveModelsDir(), [DECISION_REPO_ENV]: repo };
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

/** Whether a model's weights were vendored into the models directory. */
function weightsPresent(repo: string): boolean {
  return existsSync(join(resolveModelsDir(), repo, "config.json"));
}

/**
 * Typed decisions on a local Jev-shaped model (spec 0017). The model runs in
 * its own child process, like the generation worker: its inference is a
 * synchronous native call of up to a second, which in the backend would stall
 * every RPC and the wall. The process is started on the first decision and
 * restarted when the model preference changes.
 */
@injectable()
export class SpexrDecisionBackendService implements SpexrDecisionService {
  private model: DecisionModel = DEFAULT_DECISION_MODEL;
  private worker: DecisionWorkerLike | undefined;
  private seq = 0;
  private readonly pending = new Map<number, (d: DecisionAnswer | undefined) => void>();

  // @unmanaged(): inversify must not try to inject these test seams.
  constructor(
    @unmanaged() private readonly factory: (repo: string) => DecisionWorkerLike = defaultWorkerFactory,
    @unmanaged() private readonly available: (repo: string) => boolean = weightsPresent,
    @unmanaged() private readonly timeoutMs: number = DECIDE_TIMEOUT_MS,
  ) {}

  async setModel(model: DecisionModel): Promise<void> {
    if (model === this.model) return;
    this.model = model;
    this.stop();
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
    if (!this.available(repo)) return undefined;
    const text = state.trim();
    if (question.type !== "choice" || question.options.length < 2) {
      const answer = await this.ask(repo, text, question);
      return answer ? ({ ...answer, model } as Decision) : undefined;
    }
    const distributions: Readonly<Record<string, number>>[] = [];
    for (const order of rotations(question.options, CHOICE_ROTATIONS)) {
      const answer = await this.ask(repo, text, { ...question, options: order });
      if (answer?.type !== "choice") return undefined;
      distributions.push(answer.probabilities);
    }
    return { type: "choice", ...averageChoices(question.options, distributions), model };
  }

  /** One round trip to the worker; undefined on error, crash or timeout. */
  private async ask(
    repo: string,
    state: string,
    question: DecisionQuestion,
  ): Promise<DecisionAnswer | undefined> {
    const worker = (this.worker ??= this.start(repo));
    const id = ++this.seq;
    const answer = await new Promise<DecisionAnswer | undefined>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(undefined);
      }, this.timeoutMs);
      this.pending.set(id, (d) => {
        clearTimeout(timer);
        resolve(d);
      });
      worker.postMessage({ id, state, question });
    });
    return answer;
  }

  private start(repo: string): DecisionWorkerLike {
    const worker = this.factory(repo);
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

  private settleAll(): void {
    for (const settle of this.pending.values()) settle(undefined);
    this.pending.clear();
  }
}
