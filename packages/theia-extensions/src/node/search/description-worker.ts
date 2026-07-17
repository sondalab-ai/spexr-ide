// Runs the text-generation model in a dedicated worker thread so inference never
// stalls the backend event loop. Receives WorkerRequest messages, runs inference,
// then posts a final cleaned description (or an error). One request at a time:
// the model is single-threaded and the parent serializes anyway.
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

type TextGenPipeline = (
  messages: unknown,
  options: unknown,
) => Promise<Array<{ generated_text?: Array<{ role: string; content: string }> }>>;

let pipePromise: Promise<TextGenPipeline> | undefined;

function getPipe(): Promise<TextGenPipeline> {
  if (!pipePromise) {
    env.allowRemoteModels = false;
    env.localModelPath = modelsDir;
    pipePromise = pipeline("text-generation", GEN_MODEL_ID, { dtype: "q4" }) as unknown as Promise<TextGenPipeline>;
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
