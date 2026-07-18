// Runs the text-generation model in a dedicated worker thread. Receives
// WorkerRequest messages, runs inference, then posts a final cleaned description
// (or an error). One request at a time: the parent serializes anyway.
//
// A worker thread shares the process with the backend, and onnxruntime defaults
// its intra-op pool to one thread PER CORE — so sustained inference pinned all
// cores and starved the backend event loop, which the frontend then reported as
// "offline". Cap the pool to half the cores (see getPipe) to keep the backend
// responsive; the inference is only marginally slower.
import { cpus } from "node:os";
import { parentPort, workerData } from "node:worker_threads";
import { env, pipeline } from "@huggingface/transformers";
import {
  GEN_MODEL_ID,
  MAX_NEW_TOKENS,
  DESCRIPTION_SYSTEM_PROMPT,
  SUMMARY_MAX_NEW_TOKENS,
  SUMMARY_SYSTEM_PROMPT,
  buildSummaryPrompt,
  buildPrompt,
  cleanGenerated,
  type WorkerRequest,
  type WorkerResponse,
} from "./description-format.js";

const port = parentPort;
const modelsDir: string = workerData?.modelsDir;

// Surface JS-level crashes in the backend output (the host only sees the exit).
process.on("uncaughtException", (err) => {
  console.error("[darkfactory worker] uncaughtException:", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("[darkfactory worker] unhandledRejection:", err);
});

type TextGenPipeline = (
  messages: unknown,
  options: unknown,
) => Promise<Array<{ generated_text?: Array<{ role: string; content: string }> }>>;

let pipePromise: Promise<TextGenPipeline> | undefined;

// Leave at least half the cores for the backend event loop (see file header).
const INTRA_OP_THREADS = Math.max(1, Math.floor(cpus().length / 2));

function getPipe(): Promise<TextGenPipeline> {
  if (!pipePromise) {
    env.allowRemoteModels = false;
    env.localModelPath = modelsDir;
    pipePromise = pipeline("text-generation", GEN_MODEL_ID, {
      dtype: "q4",
      session_options: { intraOpNumThreads: INTRA_OP_THREADS, interOpNumThreads: 1 },
    }) as unknown as Promise<TextGenPipeline>;
  }
  return pipePromise;
}

function post(msg: WorkerResponse): void {
  port?.postMessage(msg);
}

async function handle(req: WorkerRequest): Promise<void> {
  const { id, kind, relPath, content } = req;
  try {
    const pipe = await getPipe();
    const system = kind === "summary" ? SUMMARY_SYSTEM_PROMPT : DESCRIPTION_SYSTEM_PROMPT;
    const user = kind === "summary" ? buildSummaryPrompt(content) : buildPrompt(relPath, content);
    const maxTokens = kind === "summary" ? SUMMARY_MAX_NEW_TOKENS : MAX_NEW_TOKENS;
    const out = await pipe(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { max_new_tokens: maxTokens, do_sample: false },
    );
    const msgs = out[0]?.generated_text;
    const last = Array.isArray(msgs) ? msgs[msgs.length - 1] : undefined;
    const raw = typeof last?.content === "string" ? last.content : "";
    // Summaries are multi-line (Now:/Overview:) and parsed by the caller; only the
    // single-line file description goes through cleanGenerated.
    const text = kind === "summary" ? raw.trim() : cleanGenerated(raw);
    post({ id, type: "done", text: text.length > 0 ? text : null });
  } catch {
    post({ id, type: "error" });
  }
}

// Serialize requests: chain each onto the previous so only one inference runs.
let chain: Promise<void> = Promise.resolve();
port?.on("message", (req: WorkerRequest) => {
  chain = chain.then(() => handle(req));
});
