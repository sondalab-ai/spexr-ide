/**
 * Which text-generation model the description worker loads.
 *
 * Only the *generation* model is configurable. The embedding model is not: its
 * output dimension is a compile-time constant and the vectors it produced are
 * persisted under `.spexr/`, so swapping it would score a new encoder against an
 * index that still looks valid — see the note on `MODEL_ID` in
 * `node/search/embedding-model.ts`. A description is regenerable text; an
 * embedding index is not.
 */
export type GenerationDtype = "q4" | "q4f16" | "q8" | "int8" | "fp16" | "fp32";

export const GENERATION_DTYPES: readonly GenerationDtype[] = [
  "q4",
  "q4f16",
  "q8",
  "int8",
  "fp16",
  "fp32",
];

export interface GenerationModelConfig {
  /** Hugging Face repo id, e.g. `onnx-community/Qwen2.5-Coder-1.5B-Instruct`. */
  readonly id: string;
  readonly dtype: GenerationDtype;
}

/**
 * Built-in model, vendored into `resources/models` by `pnpm fetch-model`.
 *
 * 1.5B (not 0.5B): on-demand descriptions are computed for only the top-N search
 * hits and streamed, so the ~2s/file (vs ~0.6s) is acceptable, and the quality
 * gain is large — the 1.5B grounds descriptions in the actual symbols/API
 * instead of the 0.5B's generic guesses. ~1.8GB at q4.
 */
export const DEFAULT_GENERATION_MODEL: GenerationModelConfig = {
  id: "onnx-community/Qwen2.5-Coder-1.5B-Instruct",
  dtype: "q4",
};

/** Env vars carrying the choice to the forked worker and to the fetch script. */
export const GEN_MODEL_ENV = "SPEXR_GEN_MODEL";
export const GEN_DTYPE_ENV = "SPEXR_GEN_DTYPE";

/**
 * Read a model choice out of an environment, falling back to the built-in one.
 *
 * Each half falls back on its own: an unset id keeps the default model, and an
 * id set with an unrecognised dtype keeps `q4` rather than passing a bad value
 * to the runtime — a typo in a preference should cost quality, not crash the
 * worker into the streak that disables descriptions until restart.
 */
export function resolveGenerationModel(
  env: Readonly<Record<string, string | undefined>>,
): GenerationModelConfig {
  const id = env[GEN_MODEL_ENV]?.trim();
  return {
    id: id && id.length > 0 ? id : DEFAULT_GENERATION_MODEL.id,
    dtype: coerceDtype(env[GEN_DTYPE_ENV]),
  };
}

/** A dtype the runtime understands, or the built-in one. */
export function coerceDtype(raw: string | undefined): GenerationDtype {
  const value = raw?.trim();
  return GENERATION_DTYPES.find((d) => d === value) ?? DEFAULT_GENERATION_MODEL.dtype;
}

/** Whether two model choices name the same weights. */
export function sameGenerationModel(
  a: GenerationModelConfig,
  b: GenerationModelConfig,
): boolean {
  return a.id === b.id && a.dtype === b.dtype;
}
