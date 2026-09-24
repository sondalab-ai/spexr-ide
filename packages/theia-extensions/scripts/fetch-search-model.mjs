// Downloads the models into resources/models so the app runs fully offline:
// all-MiniLM-L6-v2 (embeddings, q8) and the generation model (descriptions and
// summaries). The ids and dtypes MUST match the runtime — embedding-model.ts
// MODEL_ID/dtype, and common/generation-model.ts DEFAULT_GENERATION_MODEL —
// or the offline loader (env.allowRemoteModels=false) will not find the weights.
//
// Run once after a fresh/clean checkout or before packaging:
//   node scripts/fetch-search-model.mjs
//
// To vendor an alternative generation model, pass the same variables the app
// reads (spexr.search.generationModel / …Dtype set them for the worker):
//   SPEXR_GEN_MODEL=onnx-community/Qwen3-1.7B-ONNX SPEXR_GEN_DTYPE=q4 \
//     node scripts/fetch-search-model.mjs
// The embedding model is deliberately not overridable: its dimension is compiled
// in and its vectors are persisted, so swapping it corrupts the index.
//
// Decision models (spec 0017, spexr.decisions.model): kev-4b by default; pass
//   SPEXR_DECISION_MODELS=kev-4b,kev-0.6b   (or "none")
// The repos MUST match common/decision-protocol.ts DECISION_MODEL_REPOS, and the
// dtype the decision worker loads (q4).
import { env, pipeline } from "@huggingface/transformers";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const modelsDir = resolve(here, "..", "resources", "models");

env.allowRemoteModels = true;
env.cacheDir = modelsDir; // store the downloaded files here

const embedId = "Xenova/all-MiniLM-L6-v2";
console.log(`Fetching ${embedId} into ${modelsDir} ...`);
await pipeline("feature-extraction", embedId, { dtype: "q8" });

const genId = process.env.SPEXR_GEN_MODEL?.trim() || "onnx-community/Qwen2.5-Coder-1.5B-Instruct";
const genDtype = process.env.SPEXR_GEN_DTYPE?.trim() || "q4";
console.log(`Fetching ${genId} (${genDtype}) into ${modelsDir} ...`);
await pipeline("text-generation", genId, { dtype: genDtype });

const DECISION_REPOS = { "kev-4b": "onnx-community/kev-4b-ONNX", "kev-0.6b": "onnx-community/kev-0.6b-ONNX" };
const wanted = (process.env.SPEXR_DECISION_MODELS ?? "kev-4b")
  .split(",")
  .map((m) => m.trim())
  .filter((m) => m && m !== "none");
if (wanted.length > 0) {
  const { OpenJev } = await import("open-jev");
  for (const name of wanted) {
    const repo = DECISION_REPOS[name];
    if (!repo) throw new Error(`Unknown decision model ${name}; expected ${Object.keys(DECISION_REPOS).join(", ")}`);
    console.log(`Fetching ${repo} (q4) into ${modelsDir} ...`);
    const jev = await OpenJev.load({ model: repo, device: "cpu", dtype: "q4" });
    await jev.dispose();
  }
}

console.log("Done.");
