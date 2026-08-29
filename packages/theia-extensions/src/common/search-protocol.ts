import type { GenerationModelConfig } from "./generation-model.js";
export const SEARCH_SERVICE_PATH = "/services/spexr-search";

/** One ranked search result. */
export interface SearchHit {
  /** Workspace-relative POSIX path of the matched file. */
  path: string;
  /** Cosine similarity in [0, 1]; higher is more relevant. */
  score: number;
  /** Short text excerpt for display. */
  snippet: string;
  /** File category: "frontend" | "backend" | "test" | "config" | "other". */
  category: string;
  /** Short description extracted from doc comments or export names. */
  description: string;
}

/** Streamed progress of an AI description for one file. */
export interface DescriptionUpdate {
  /** Workspace-relative POSIX path the description belongs to. */
  path: string;
  /** Text so far (grows as tokens stream); final text when `done`. */
  text: string;
  /** True once generation finished (success or, with `failed`, giving up). */
  done: boolean;
  /** True when generation failed or the model is unavailable. */
  failed?: boolean;
}

export type DescriptionJobState = "idle" | "running" | "paused" | "complete" | "error";

/** Progress of the workspace-wide description generation job. */
export interface DescriptionJobStatus {
  state: DescriptionJobState;
  /** Targets processed this run (reaches `total` at completion). */
  done: number;
  /** Size of the target set, fixed when the job starts. */
  total: number;
  /** Set when `state` is `error`. */
  message?: string;
}

/** Client callbacks the backend pushes description progress to. */
export interface SpexrSearchClient {
  onDescriptionUpdate(update: DescriptionUpdate): void;
  onDescriptionJobProgress(status: DescriptionJobStatus): void;
}

export type IndexState = "idle" | "indexing" | "ready" | "error";

export interface IndexStatus {
  state: IndexState;
  indexed: number;
  total: number;
  message?: string;
}

/**
 * Backend search service. Methods are root-first: the workspace root identifies
 * the (stateful) per-workspace index, mirroring {@link SpexrGitService}.
 *
 * IMPORTANT: `root` MUST be an absolute filesystem path (e.g. `/Users/me/proj`),
 * NOT a `file://` URI string. Callers must derive it via
 * `WorkspaceService.tryGetRoots()[0]?.resource.path.toString()`.
 * Passing a URI string causes every `path.join(root, rel)` call in the backend
 * to produce garbage paths, resulting in ENOENT on all filesystem operations.
 */
export interface SpexrSearchService {
  /** Build the index in the background if it does not exist yet; returns at once. */
  ensureIndexed(root: string): Promise<void>;
  search(root: string, query: string): Promise<SearchHit[]>;
  getIndexStatus(root: string): Promise<IndexStatus>;
  /** Apply incremental file changes (workspace-relative POSIX paths). */
  applyChanges(root: string, changedPaths: string[], removedPaths: string[]): Promise<void>;
  /** Force a full rebuild. */
  reindex(root: string): Promise<void>;
  /**
   * Generate AI descriptions for the given files, one at a time, streaming
   * progress back to the client via {@link SpexrSearchClient.onDescriptionUpdate}.
   * Cached descriptions are emitted immediately. Resolves when all are handled.
   */
  describeFiles(root: string, paths: string[]): Promise<void>;
  /**
   * Start the workspace-wide description job ("Understand the codebase"), using the
   * local model to describe every file worth mapping. `regenerate` overwrites
   * existing descriptions instead of only filling gaps.
   */
  startDescriptionJob(root: string, opts: { regenerate: boolean }): Promise<void>;
  /** Request the running job to pause after the current file. */
  pauseDescriptionJob(root: string): Promise<void>;
  /** Resume a paused job. */
  resumeDescriptionJob(root: string): Promise<void>;
  /** Current job status (idle if never started). */
  getDescriptionJobStatus(root: string): Promise<DescriptionJobStatus>;
  /**
   * Re-persist in-memory index/descriptions whose on-disk `.spexr/` copy vanished
   * while the workspace is `ready`. Cheap write-back; no-op if files already exist.
   */
  persistIfMissing(root: string): Promise<void>;
  /**
   * Point local description generation at different weights. Process-global, not
   * root-scoped: one model process serves every workspace. Restarts the worker
   * when the choice differs from what it is running.
   */
  setGenerationModel(config: GenerationModelConfig): Promise<void>;
  /** True if `.spexr/` is already ignored at the user's global git level. */
  isSpexrGloballyIgnored(): Promise<boolean>;
  /** Append `.spexr/` to the user's global git ignore; resolves true once it is present. */
  addSpexrToGlobalIgnore(): Promise<boolean>;
}
