import { injectable } from "@theia/core/shared/inversify";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { resolveModelsDir } from "./models-dir.js";

export const EMBEDDING_DIM = 384;

/**
 * Deliberately NOT user-configurable, unlike the generation model
 * (`common/generation-model.ts`). `EMBEDDING_DIM` is a compile-time constant and
 * the vectors this encoder produced are persisted under `.spexr/`, gated by
 * `INDEX_VERSION` rather than by model id — so a different encoder would be
 * scored against an index that still looks valid, throwing in `vector-math` at
 * best and returning meaningless similarities at worst. Changing it means
 * bumping `INDEX_VERSION` and forcing a full reindex.
 */
export const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/** Produces sentence embeddings for a batch of texts. */
export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
}

/**
 * In-process ONNX embedder over `all-MiniLM-L6-v2`, configured for offline use.
 * The pipeline is loaded lazily on first `embed` and reused afterwards.
 */
@injectable()
export class TransformersEmbedder implements Embedder {
  private pipelinePromise?: Promise<FeatureExtractionPipeline>;

  private getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      env.allowRemoteModels = false;
      env.localModelPath = resolveModelsDir();
      this.pipelinePromise = pipeline("feature-extraction", MODEL_ID, {
        dtype: "q8",
      });
    }
    return this.pipelinePromise;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const extractor = await this.getPipeline();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const rows = output.tolist() as number[][];
    return rows.map((row) => Float32Array.from(row));
  }
}

/** Inversify token for the {@link Embedder} implementation. */
export const EmbedderToken = Symbol("Embedder");
