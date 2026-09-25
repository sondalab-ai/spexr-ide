import type { IndexRecord } from "./vector-index.js";
import type { DescriptionJobStatus } from "../../common/search-protocol.js";
import type { DescriptionGenerator } from "./description-format.js";
import type { DescriptionsStore, StoredDescription } from "./descriptions-store.js";
import { isWorthMapping } from "./map-scope-filter.js";

/** Store writes are batched to avoid an atomic disk write per file on large repos. */
const FLUSH_INTERVAL = 20;

export interface DescriptionJobDeps {
  /** Live index records, re-read at start() so reindex swaps are visible. */
  records: () => IndexRecord[];
  readContent: (relPath: string) => Promise<string>;
  /** Local model that produces one whole-file description at a time. */
  generator: DescriptionGenerator;
  store: DescriptionsStore;
  /** Write codebase-map.md from the store; called once on completion. */
  writeMarkdown: () => Promise<void>;
  /** Push a status snapshot to observers. */
  emit: (status: DescriptionJobStatus) => void;
}

/**
 * Workspace-wide description generator. Walks records that are worth mapping and
 * missing a store entry (or all worth-mapping records, when regenerating),
 * describing each with the local model, merging results into the descriptions
 * store, and exporting the markdown map on completion. Pausing is cooperative —
 * it takes effect between files, never mid-generation.
 */
export class DescriptionJob {
  private state: DescriptionJobStatus["state"] = "idle";
  private done = 0;
  private total = 0;
  private message?: string;
  private targets: string[] = [];
  private cursor = 0;
  private pauseRequested = false;
  private categoryByPath = new Map<string, string>();
  private pending = new Map<string, StoredDescription>();

  constructor(private readonly deps: DescriptionJobDeps) {}

  get status(): DescriptionJobStatus {
    const s: DescriptionJobStatus = { state: this.state, done: this.done, total: this.total };
    if (this.message !== undefined) s.message = this.message;
    return s;
  }

  async start(opts: { regenerate: boolean }): Promise<void> {
    if (this.state === "running") return;
    const recs = this.deps.records();
    this.categoryByPath = new Map(recs.map((r) => [r.path, r.category]));
    this.targets = recs
      .filter((r) => isWorthMapping(r.path))
      .filter((r) => opts.regenerate || this.deps.store.get(r.path) === undefined)
      .map((r) => r.path);
    this.cursor = 0;
    this.done = 0;
    this.total = this.targets.length;
    delete this.message;
    this.pending = new Map();
    this.pauseRequested = false;
    this.state = "running";
    this.deps.emit(this.status);
    await this.run();
  }

  pause(): void {
    if (this.state === "running") this.pauseRequested = true;
  }

  async resume(): Promise<void> {
    // A pause still waiting for the current file to finish is simply withdrawn.
    if (this.state === "running") this.pauseRequested = false;
    if (this.state !== "paused") return;
    this.pauseRequested = false;
    this.state = "running";
    this.deps.emit(this.status);
    await this.run();
  }

  /** Persist any buffered descriptions. Cheap no-op when the buffer is empty. */
  private async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    await this.deps.store.merge(this.pending);
    this.pending = new Map();
  }

  private async run(): Promise<void> {
    try {
      while (this.cursor < this.targets.length) {
        if (this.pauseRequested) {
          await this.flush();
          this.state = "paused";
          this.deps.emit(this.status);
          return;
        }
        if (!this.deps.generator.isAvailable()) {
          await this.flush();
          this.state = "error";
          this.message = "Description model not available.";
          this.deps.emit(this.status);
          return;
        }
        const relPath = this.targets[this.cursor]!;
        try {
          const content = await this.deps.readContent(relPath);
          const text = await this.deps.generator.generate(relPath, content);
          if (text) {
            this.pending.set(relPath, {
              description: text,
              category: this.categoryByPath.get(relPath) ?? "other",
            });
          }
        } catch {
          // unreadable file or generation failure: skip it but still advance the cursor
        }
        this.cursor += 1;
        this.done = this.cursor;
        if (this.pending.size >= FLUSH_INTERVAL) await this.flush();
        this.deps.emit(this.status);
      }
      await this.flush();
      await this.deps.writeMarkdown();
      this.state = "complete";
      this.deps.emit(this.status);
    } catch (err) {
      this.state = "error";
      this.message = err instanceof Error ? err.message : String(err);
      this.deps.emit(this.status);
    }
  }
}
