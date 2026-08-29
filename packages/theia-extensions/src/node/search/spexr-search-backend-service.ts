import { inject, injectable } from "@theia/core/shared/inversify";
import type {
  SpexrSearchService,
  SpexrSearchClient,
  SearchHit,
  IndexStatus,
  DescriptionJobStatus,
} from "../../common/search-protocol.js";
import type { GenerationModelConfig } from "../../common/generation-model.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Embedder as EmbedderType } from "./embedding-model.js";
import { EmbedderToken } from "./embedding-model.js";
import { DescriptionGeneratorToken, type DescriptionGenerator } from "./description-format.js";
import { WorkspaceIndexer } from "./workspace-indexer.js";
import { expandQuery } from "./query-expander.js";
import { DescriptionJob } from "./description-job.js";
import { CodebaseMapWriter } from "./codebase-map-writer.js";
import { DescriptionsStore } from "./descriptions-store.js";
import { isSpexrIgnoredGlobally, ensureSpexrGloballyIgnored } from "./global-gitignore.js";

const TOP_K = 30;
const MIN_SCORE = 0.18;
const DENSE_CANDIDATE_THRESHOLD = 0.05;
const DENSE_WEIGHT = 0.65;
const BM25_WEIGHT = 0.35;

interface Workspace {
  indexer: WorkspaceIndexer;
  status: IndexStatus;
  building?: Promise<void>;
  /** Changes that arrived while an index build was in progress, queued for replay. */
  pendingChanges?: { changed: string[]; removed: string[] };
  /** Cached job-creation promise; build-once to prevent double-start under concurrent calls. */
  jobReady?: Promise<DescriptionJob>;
  /** Per-workspace descriptions store; loaded lazily once (promise cached to avoid a load race). */
  storeReady?: Promise<DescriptionsStore>;
}

/**
 * Per-workspace search backend: lazily builds and caches a {@link WorkspaceIndexer}
 * per root, runs queries against it, and degrades to an "error" status if the
 * embedding model cannot run.
 */
@injectable()
export class SpexrSearchBackendService implements SpexrSearchService {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly descBatchSeq = new Map<string, number>();
  private client: SpexrSearchClient | undefined;

  constructor(
    @inject(EmbedderToken) private readonly embedder: EmbedderType,
    @inject(DescriptionGeneratorToken) private readonly generator: DescriptionGenerator,
  ) {}

  /** Wired by the RPC connection handler so the backend can stream to the frontend. */
  setClient(client: SpexrSearchClient | undefined): void {
    this.client = client;
  }

  async setGenerationModel(config: GenerationModelConfig): Promise<void> {
    this.generator.setModel?.(config);
  }

  private getOrCreate(root: string): Workspace {
    let ws = this.workspaces.get(root);
    if (!ws) {
      ws = {
        indexer: new WorkspaceIndexer(root, this.embedder),
        status: { state: "idle", indexed: 0, total: 0 },
      };
      this.workspaces.set(root, ws);
    }
    return ws;
  }

  /** Returns the per-workspace store, loading it once. */
  private getStore(ws: Workspace, root: string): Promise<DescriptionsStore> {
    // Cache the load promise (not just the instance) so a concurrent caller never
    // observes a constructed-but-not-yet-loaded store.
    ws.storeReady ??= (async () => {
      const store = new DescriptionsStore(root);
      await store.load();
      return store;
    })();
    return ws.storeReady;
  }

  async ensureIndexed(root: string): Promise<void> {
    const ws = this.getOrCreate(root);
    if (ws.status.state === "ready" || ws.status.state === "indexing") return;
    void this.build(ws, root);
  }

  async reindex(root: string): Promise<void> {
    const ws = this.getOrCreate(root);
    if (ws.building) await ws.building; // drain in-flight build first
    // Discard the persisted index and the in-memory state so the rebuild starts
    // empty: this is the only path that picks up changes to extraction logic
    // (descriptions, categories, symbols, embeddings) for unchanged files.
    delete ws.pendingChanges;
    delete ws.jobReady;
    ws.indexer = new WorkspaceIndexer(root, this.embedder);
    ws.status = { state: "idle", indexed: 0, total: 0 };
    await this.build(ws, root, true);
  }

  async describeFiles(root: string, paths: string[]): Promise<void> {
    const ws = this.workspaces.get(root);
    if (!ws) return;
    const seq = (this.descBatchSeq.get(root) ?? 0) + 1;
    this.descBatchSeq.set(root, seq);
    let dirty = false;
    for (const path of paths) {
      if (this.descBatchSeq.get(root) !== seq) return; // newer query arrived
      const need = await this.resolveOrCollect(ws, root, path);
      if (!need) continue;
      if (!this.generator.isAvailable()) {
        this.emit({ path, text: "", done: true, failed: true });
        continue;
      }
      const text = await this.generator.generate(need.path, need.content);
      if (this.descBatchSeq.get(root) !== seq) return;
      if (!text) {
        this.emit({ path, text: "", done: true, failed: true });
        continue;
      }
      ws.indexer.index.setAiDescription(path, text);
      dirty = true;
      this.emit({ path, text, done: true });
    }
    if (dirty) await ws.indexer.save();
  }

  /**
   * Resolve a file's description from the precomputed store, cache, or static prose,
   * and emit it; or return the file content to generate with the local model.
   * Returns undefined when nothing more is needed (unknown path, cached, prose, or unreadable).
   *
   * Priority: descriptions store > cached aiDescription > static prose > generate.
   */
  private async resolveOrCollect(
    ws: Workspace,
    root: string,
    path: string,
  ): Promise<{ path: string; content: string } | undefined> {
    // A precomputed store entry (from the "Understand the codebase" job) wins over everything.
    const store = await this.getStore(ws, root);
    const storeDesc = store.get(path);
    if (storeDesc !== undefined) {
      this.emit({ path, text: storeDesc, done: true });
      return undefined;
    }

    const record = ws.indexer.index.getRecord(path);
    if (!record) return undefined;
    if (record.aiDescription) {
      this.emit({ path, text: record.aiDescription, done: true });
      return undefined;
    }
    // Prose from a doc-comment is already high-quality — skip the model.
    // Structural descriptions ("Exports X, Y" / "Defines Foo") are worth replacing with AI prose.
    const staticDesc = record.description ?? "";
    const isStructural = staticDesc.startsWith("Exports ") || staticDesc.startsWith("Defines ");
    if (staticDesc && !isStructural) {
      this.emit({ path, text: staticDesc, done: true });
      return undefined;
    }
    try {
      return { path, content: await readFile(join(root, path), "utf8") };
    } catch {
      this.emit({ path, text: "", done: true, failed: true });
      return undefined;
    }
  }

  private emit(update: { path: string; text: string; done: boolean; failed?: boolean }): void {
    this.client?.onDescriptionUpdate(update);
  }

  private getJob(ws: Workspace, root: string): Promise<DescriptionJob> {
    // Cache the creation promise (not just the instance) so concurrent calls
    // never build+start two independent jobs.
    ws.jobReady ??= (async () => {
      const store = await this.getStore(ws, root);
      return new DescriptionJob({
        records: () => ws.indexer.index.allRecords(),
        readContent: (rel) => readFile(join(root, rel), "utf8"),
        generator: this.generator,
        store,
        writeMarkdown: () =>
          new CodebaseMapWriter(root).writeMarkdown(
            [...store.entries()].map(([path, v]) => ({ path, category: v.category, description: v.description })),
          ),
        emit: (s) => this.client?.onDescriptionJobProgress(s),
      });
    })();
    return ws.jobReady;
  }

  async startDescriptionJob(root: string, opts: { regenerate: boolean }): Promise<void> {
    const ws = this.getOrCreate(root);
    delete ws.jobReady;
    if (ws.status.state !== "ready") await this.build(ws, root);
    if (ws.status.state !== "ready") return; // build failed → leave job idle
    void (await this.getJob(ws, root)).start({ regenerate: opts.regenerate }); // fire-and-forget
  }

  async pauseDescriptionJob(root: string): Promise<void> {
    const ws = this.workspaces.get(root);
    if (!ws?.jobReady) return;
    (await ws.jobReady).pause();
  }

  async resumeDescriptionJob(root: string): Promise<void> {
    const ws = this.workspaces.get(root);
    if (!ws?.jobReady) return;
    await (await ws.jobReady).resume();
  }

  async getDescriptionJobStatus(root: string): Promise<DescriptionJobStatus> {
    const ws = this.workspaces.get(root);
    if (!ws?.jobReady) return { state: "idle", done: 0, total: 0 };
    return (await ws.jobReady).status;
  }

  /**
   * Re-persist in-memory state whose on-disk copy vanished (e.g. `.spexr/` deleted
   * externally while the workspace is `ready`). The index and descriptions store are
   * held in memory, so restoring the folder is a cheap write-back — no re-embedding.
   * No-op when the workspace is not ready or the files are already present.
   */
  async persistIfMissing(root: string): Promise<void> {
    const ws = this.workspaces.get(root);
    if (!ws || ws.status.state !== "ready") return;
    if (!(await ws.indexer.isPersisted())) await ws.indexer.save();
    if (ws.storeReady) {
      const store = await ws.storeReady;
      if (store.size > 0 && !(await store.isPersisted())) await store.persist();
    }
  }

  async isSpexrGloballyIgnored(): Promise<boolean> {
    return isSpexrIgnoredGlobally();
  }

  async addSpexrToGlobalIgnore(): Promise<boolean> {
    await ensureSpexrGloballyIgnored();
    return true;
  }

  /** Build (or rebuild) an index, updating status; never throws. */
  private build(ws: Workspace, root: string, force = false): Promise<void> {
    if (ws.building) return ws.building;
    ws.status = { state: "indexing", indexed: 0, total: 0 };
    ws.building = (async () => {
      try {
        if (!force && await ws.indexer.load()) {
          if (ws.pendingChanges) {
            const { changed, removed } = ws.pendingChanges;
            delete ws.pendingChanges;
            for (const rel of removed) ws.indexer.removeFile(rel);
            for (const rel of changed) {
              try { await ws.indexer.updateFile(rel); } catch { /* ignore */ }
            }
            await ws.indexer.save();
          }
          ws.status = { state: "ready", indexed: ws.indexer.index.size, total: ws.indexer.index.size };
          return;
        }
        await ws.indexer.buildAll((indexed, total) => {
          ws.status = { state: "indexing", indexed, total };
        });
        await ws.indexer.save();
        if (ws.pendingChanges) {
          const { changed, removed } = ws.pendingChanges;
          delete ws.pendingChanges;
          for (const rel of removed) ws.indexer.removeFile(rel);
          for (const rel of changed) {
            try { await ws.indexer.updateFile(rel); } catch { /* ignore */ }
          }
          await ws.indexer.save();
        }
        ws.status = { state: "ready", indexed: ws.indexer.index.size, total: ws.indexer.index.size };
      } catch (err) {
        ws.status = {
          state: "error",
          indexed: ws.indexer.index.size,
          total: ws.indexer.index.size,
          message: err instanceof Error ? err.message : String(err),
        };
      } finally {
        delete ws.building;
      }
    })();
    return ws.building;
  }

  async getIndexStatus(root: string): Promise<IndexStatus> {
    return this.getOrCreate(root).status;
  }

  async search(root: string, query: string): Promise<SearchHit[]> {
    const ws = this.workspaces.get(root);
    if (!ws || ws.indexer.index.size === 0 || query.trim().length === 0) return [];
    try {
      const expanded = expandQuery(query);
      const [vector] = await this.embedder.embed([expanded]);

      // Dense pass with low threshold to widen the candidate pool.
      const denseCandidates = ws.indexer.index.search(vector!, TOP_K * 3, DENSE_CANDIDATE_THRESHOLD);
      const denseMap = new Map(denseCandidates.map((h) => [h.path, h]));

      // BM25 pass over all indexed docs.
      const bm25Raw = ws.indexer.bm25.score(expanded);
      const maxBm25 = Math.max(...bm25Raw.values(), 0.001);

      // Union: dense candidates + BM25-strong docs not in dense.
      const candidatePaths = new Set(denseCandidates.map((h) => h.path));
      for (const [path, score] of bm25Raw) {
        if (score / maxBm25 >= 0.3) candidatePaths.add(path);
      }

      const results: SearchHit[] = [];
      for (const path of candidatePaths) {
        const denseHit = denseMap.get(path);
        const cosine = denseHit?.score ?? 0;
        const bm25 = (bm25Raw.get(path) ?? 0) / maxBm25;
        const hybrid = DENSE_WEIGHT * cosine + BM25_WEIGHT * bm25;
        if (hybrid < MIN_SCORE) continue;
        const rec = denseHit ?? ws.indexer.index.getRecord(path);
        results.push({
          path,
          score: hybrid,
          snippet: rec?.snippet ?? "",
          category: rec?.category ?? "other",
          description: rec?.description ?? "",
        });
      }

      results.sort((a, b) => b.score - a.score);
      return results.slice(0, TOP_K);
    } catch (err) {
      ws.status = {
        state: "error",
        indexed: ws.indexer.index.size,
        total: ws.indexer.index.size,
        message: err instanceof Error ? err.message : String(err),
      };
      return [];
    }
  }

  async applyChanges(root: string, changedPaths: string[], removedPaths: string[]): Promise<void> {
    const ws = this.workspaces.get(root);
    if (!ws) return;
    if (ws.status.state !== "ready") {
      // Queue for replay once the build completes.
      const p = ws.pendingChanges ?? (ws.pendingChanges = { changed: [], removed: [] });
      p.changed.push(...changedPaths);
      p.removed.push(...removedPaths);
      return;
    }
    // Only persist when the index actually changed. Background file churn (`.git/`,
    // build output, editors touching files without content changes) otherwise triggers
    // a full index write per event — a stream of `.spexr/*.tmp` with no real work.
    let dirty = false;
    for (const rel of removedPaths) {
      if (ws.indexer.removeFile(rel)) dirty = true;
    }
    if (removedPaths.length > 0 && ws.storeReady) {
      const store = await ws.storeReady;
      await store.removeMany(removedPaths); // store persists itself only when it changed
    }
    for (const rel of changedPaths) {
      try {
        if (await ws.indexer.updateFile(rel)) dirty = true;
      } catch {
        // a single bad file must not break the batch
      }
    }
    if (dirty) await ws.indexer.save();
    ws.status = { state: "ready", indexed: ws.indexer.index.size, total: ws.indexer.index.size };
  }
}
