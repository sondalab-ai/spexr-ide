// Runs the text-generation model in a SEPARATE child process (forked, not a
// worker thread). Receives WorkerRequest messages over IPC, runs inference, then
// posts a final cleaned description (or an error). One request at a time: the
// parent serializes anyway.
//
// Why a child process, not a worker_thread: a worker thread shares the backend's
// process, and onnxruntime's native inference — even with its pool capped —
// degraded the Electron backend↔frontend IPC of that process into a permanent
// "offline" (the backend's JS loop stayed responsive, yet the socket starved).
// Isolating the model in its own process keeps the backend doing zero native
// work, so the connection stays healthy. The intra-op pool is still capped (see
// getPipe) to leave cores for the rest of the machine.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cpus } from "node:os";
import { env, pipeline } from "@huggingface/transformers";
import { resolveGenerationModel } from "../../common/generation-model.js";
import {
  MAX_NEW_TOKENS,
  DESCRIPTION_SYSTEM_PROMPT,
  SUMMARY_MAX_NEW_TOKENS,
  NOW_SYSTEM_PROMPT,
  OVERVIEW_SYSTEM_PROMPT,
  COMMIT_MAX_NEW_TOKENS,
  COMMIT_SYSTEM_PROMPT,
  buildPrompt,
  cleanGenerated,
  type GenerationKind,
  type WorkerRequest,
  type WorkerResponse,
} from "./description-format.js";

const modelsDir: string = process.env.SPEXR_MODELS_DIR ?? "";
const model = resolveGenerationModel(process.env);

// Surface JS-level crashes in the backend output (the host only sees the exit).
process.on("uncaughtException", (err) => {
  console.error("[darkfactory worker] uncaughtException:", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("[darkfactory worker] unhandledRejection:", err);
});
// The backend that forked us is gone — killed, or crashed. Nothing will ever ask
// for another description, and a resident model process is expensive to leave
// behind; a backend that exits normally tears us down itself, this covers the
// kills that skip its shutdown.
process.on("disconnect", () => {
  process.exit(0);
});

type TextGenPipeline = (
  messages: unknown,
  options: unknown,
) => Promise<Array<{ generated_text?: Array<{ role: string; content: string }> }>>;

let pipePromise: Promise<TextGenPipeline> | undefined;

// Leave at least half the cores for the backend event loop (see file header).
const INTRA_OP_THREADS = Math.max(1, Math.floor(cpus().length / 2));

/**
 * Prefer the WebGPU execution provider — on this hardware it ran q4 inference ~4x
 * faster than CPU (CoreML was slower than CPU on this decoder, so it is not used).
 * Only when a genuine Node runs the worker: onnxruntime-node has a segfault history
 * under ELECTRON_RUN_AS_NODE (see worker-description-generator), and a GPU segfault
 * there is uncatchable, so a packaged app with no real Node stays on CPU.
 *
 * Detection keys on `process.versions.electron`, not the ELECTRON_RUN_AS_NODE env:
 * the backend runs as Electron-as-node, so that flag is inherited by this child —
 * and Electron's fork patch re-injects it even when `execPath` points at a real
 * Node — while `process.versions.electron` truthfully reports the running binary.
 */
const PREFER_GPU = process.versions.electron === undefined;

function loadPipe(device: "webgpu" | "cpu"): Promise<TextGenPipeline> {
  return pipeline("text-generation", model.id, {
    dtype: model.dtype,
    device,
    // intraOpNumThreads bounds the CPU pool; ignored by the WebGPU provider.
    session_options: { intraOpNumThreads: INTRA_OP_THREADS, interOpNumThreads: 1 },
  }) as unknown as Promise<TextGenPipeline>;
}

async function buildPipe(): Promise<TextGenPipeline> {
  env.allowRemoteModels = false;
  env.localModelPath = modelsDir;
  // Remote loading is off, so a model that was never fetched fails deep inside
  // the runtime with a file-not-found. Say what is actually wrong instead.
  if (!existsSync(join(modelsDir, model.id))) {
    throw new Error(
      `Model "${model.id}" is not in ${modelsDir}. Fetch it first: ` +
        `SPEXR_GEN_MODEL=${model.id} SPEXR_GEN_DTYPE=${model.dtype} pnpm fetch-model`,
    );
  }
  const t0 = Date.now();
  if (PREFER_GPU) {
    try {
      console.error("[darkfactory worker] loading model (device=webgpu)…");
      const p = await loadPipe("webgpu");
      console.error(`[darkfactory worker] model loaded on webgpu in ${Date.now() - t0}ms`);
      return p;
    } catch (err) {
      console.error("[darkfactory worker] webgpu unavailable, falling back to cpu:", err);
    }
  }
  const t1 = Date.now();
  console.error(`[darkfactory worker] loading model (device=cpu, intraOpThreads=${INTRA_OP_THREADS})…`);
  const p = await loadPipe("cpu");
  console.error(`[darkfactory worker] model loaded on cpu in ${Date.now() - t1}ms`);
  return p;
}

function getPipe(): Promise<TextGenPipeline> {
  if (!pipePromise) pipePromise = buildPipe();
  return pipePromise;
}

function post(msg: WorkerResponse): void {
  process.send?.(msg);
}

const SYSTEM_BY_KIND = {
  description: DESCRIPTION_SYSTEM_PROMPT,
  now: NOW_SYSTEM_PROMPT,
  overview: OVERVIEW_SYSTEM_PROMPT,
  commit: COMMIT_SYSTEM_PROMPT,
} satisfies Record<GenerationKind, string>;

const MAX_TOKENS_BY_KIND = {
  description: MAX_NEW_TOKENS,
  now: SUMMARY_MAX_NEW_TOKENS,
  overview: SUMMARY_MAX_NEW_TOKENS,
  commit: COMMIT_MAX_NEW_TOKENS,
} satisfies Record<GenerationKind, number>;

async function handle(req: WorkerRequest): Promise<void> {
  const { id, kind, relPath, content } = req;
  const t0 = Date.now();
  try {
    const pipe = await getPipe();
    // Every kind but "description" carries a fully-built user prompt in `content`;
    // the file-description path composes its prompt here from path + content.
    // Looked up rather than chained: a ternary fallthrough would silently hand a
    // new kind the file-description prompt and its much smaller token budget.
    const k = kind ?? "description";
    const prebuilt = k !== "description";
    const system = SYSTEM_BY_KIND[k];
    const user = prebuilt ? content : buildPrompt(relPath, content);
    const maxTokens = MAX_TOKENS_BY_KIND[k];
    const tInfer = Date.now();
    const out = await pipe(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { max_new_tokens: maxTokens, do_sample: false },
    );
    console.error(
      `[darkfactory worker] ${k} done: total ${Date.now() - t0}ms, inference ${Date.now() - tInfer}ms`,
    );
    const msgs = out[0]?.generated_text;
    const last = Array.isArray(msgs) ? msgs[msgs.length - 1] : undefined;
    const raw = typeof last?.content === "string" ? last.content : "";
    // Prebuilt-prompt replies are cleaned by their caller (cleanSummaryLine,
    // cleanCommitSubject); only the file description goes through cleanGenerated.
    const text = prebuilt ? raw.trim() : cleanGenerated(raw);
    post({ id, type: "done", text: text.length > 0 ? text : null });
  } catch (err) {
    console.error(`[darkfactory worker] inference failed after ${Date.now() - t0}ms:`, err);
    post({ id, type: "error" });
  }
}

// Serialize requests: chain each onto the previous so only one inference runs.
let chain: Promise<void> = Promise.resolve();
process.on("message", (req: WorkerRequest) => {
  chain = chain.then(() => handle(req));
});
