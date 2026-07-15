import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { ConfirmDialog } from "@theia/core/lib/browser/dialogs";
import { CommandService } from "@theia/core/lib/common/command";
import { OpenerService, open } from "@theia/core/lib/browser/opener-service";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import type { SearchHit, IndexStatus, SpexrSearchService, DescriptionUpdate, DescriptionJobStatus } from "../../common/search-protocol.js";
import { PreferenceScope } from "@theia/core/lib/common/preferences/preference-scope";
import {
  SPEXR_SEARCH_AI_DESCRIPTIONS_PREFERENCE,
  SPEXR_SEARCH_GLOBAL_IGNORE_PROMPTED,
} from "../preferences/spexr-preferences.js";
import { SpexrSearchServiceProxy } from "./smart-search-service.js";
import { SpexrSearchClientDispatcher } from "./smart-search-client.js";
import { formatScore, scoreColor, statusLabel, debounce, CATEGORY_LABELS, categoryColor } from "./smart-search-format.js";

const INDEXING_MESSAGES = [
  "Scanning your workspace…",
  "Reading source files…",
  "Computing embeddings…",
  "Vectorizing the codebase…",
  "Still going… your codebase must be huge",
  "Training a neural net would've been faster",
  "Still here. Embedding every byte.",
  "Did you open the whole monorepo? Respect.",
  "Have you tried a smaller project?",
  "Still working. No, seriously.",
  "Your files are very… thorough.",
  "Somewhere, a GPU is crying.",
  "Almost there. Probably.",
  "You could've written a parser by now.",
  "We don't stop until every token suffers.",
  "This is fine. Everything is fine.",
  "404: patience not found. But we're still indexing.",
  "Bold of you to commit this many files.",
  "The model is learning about your architecture choices.",
  "At this point we're basically best friends.",
];

/** Search input + ranked results, shown above the file-tree navigator. */
@injectable()
export class SmartSearchWidget extends ReactWidget {
  static readonly ID = "spexr.view.smart-search";

  @inject(SpexrSearchServiceProxy)
  private readonly service!: SpexrSearchService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(OpenerService)
  private readonly openerService!: OpenerService;

  @inject(CommandService)
  private readonly commands!: CommandService;

  @inject(PreferenceService)
  private readonly preferences!: PreferenceService;

  @inject(SpexrSearchClientDispatcher)
  private readonly searchClient!: SpexrSearchClientDispatcher;

  private query = "";
  private hits: SearchHit[] = [];
  /** path → AI description text (final when done). */
  private aiText = new Map<string, string>();
  /** paths still generating (pulsing icon). */
  private aiPending = new Set<string>();
  /** progress counters for the current search's AI descriptions. */
  private aiTotal = 0;
  private aiDone = 0;
  private jobStatus: DescriptionJobStatus = { state: "idle", done: 0, total: 0 };
  /** active category filters; empty = show all. */
  private activeFilters = new Set<string>();
  private status: IndexStatus = { state: "idle", indexed: 0, total: 0 };
  private statusTimer?: ReturnType<typeof setInterval>;
  private indexingStart: number | undefined;

  private readonly runSearch = debounce((q: string) => void this.doSearch(q), 250);

  @postConstruct()
  protected init(): void {
    this.id = SmartSearchWidget.ID;
    this.title.label = "Search";
    this.title.caption = "Smart Search";
    this.title.closable = false;
    this.addClass("spexr-smart-search");
    this.toDispose.push(this.searchClient.onDescriptionUpdate$((u) => this.onDescriptionUpdate(u)));
    this.toDispose.push(this.searchClient.onDescriptionJobProgress$((s) => { this.jobStatus = s; this.update(); }));
    void this.refreshJobStatus();
    this.pollStatus();
    this.update();
  }

  private root(): string | undefined {
    return this.workspace.tryGetRoots()[0]?.resource.path.toString();
  }

  private pollStatus(): void {
    const tick = async (): Promise<void> => {
      const root = this.root();
      if (!root) return;
      this.status = await this.service.getIndexStatus(root);
      if (this.status.state === "indexing") {
        if (this.indexingStart === undefined) this.indexingStart = Date.now();
      } else {
        this.indexingStart = undefined;
      }
      this.update();
    };
    void tick();
    this.statusTimer = setInterval(() => void tick(), 1000);
  }

  override dispose(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.runSearch.cancel();
    super.dispose();
  }

  private async doSearch(q: string): Promise<void> {
    const root = this.root();
    if (!root || q.trim().length === 0) {
      this.hits = [];
      this.resetAiState();
      this.activeFilters.clear();
      this.update();
      return;
    }
    this.hits = await this.service.search(root, q);
    this.resetAiState();
    this.activeFilters.clear();
    this.update();
    this.requestAiDescriptions(root);
  }

  private static readonly AI_TOP_N = 5;

  private aiEnabled(): boolean {
    return this.preferences.get<boolean>(SPEXR_SEARCH_AI_DESCRIPTIONS_PREFERENCE, true);
  }

  private resetAiState(): void {
    this.aiText.clear();
    this.aiPending.clear();
    this.aiTotal = 0;
    this.aiDone = 0;
  }

  private requestAiDescriptions(root: string): void {
    if (!this.aiEnabled()) return;
    const paths = this.hits.slice(0, SmartSearchWidget.AI_TOP_N).map((h) => h.path);
    if (paths.length === 0) return;
    this.aiTotal = paths.length;
    for (const p of paths) this.aiPending.add(p);
    this.update();
    void this.service.describeFiles(root, paths);
  }

  private async refreshJobStatus(): Promise<void> {
    const root = this.root();
    if (root) {
      this.jobStatus = await this.service.getDescriptionJobStatus(root);
      if (!this.isDisposed) this.update();
    }
  }

  /** One-time consent to add `.spexr/` to the user's global git ignore. */
  private async maybePromptGlobalIgnore(): Promise<void> {
    if (this.preferences.get<boolean>(SPEXR_SEARCH_GLOBAL_IGNORE_PROMPTED, false)) return;
    if (await this.service.isSpexrGloballyIgnored()) {
      await this.preferences.set(SPEXR_SEARCH_GLOBAL_IGNORE_PROMPTED, true, PreferenceScope.User);
      return;
    }
    const ok = await new ConfirmDialog({
      title: "Ignore .spexr in git",
      msg: "Add `.spexr/` to your global git ignore so SPEXR's generated maps aren't tracked in any repository?",
      ok: "Add",
      cancel: "Skip",
    }).open();
    if (ok) await this.service.addSpexrToGlobalIgnore();
    // Record the prompt either way so it never repeats.
    await this.preferences.set(SPEXR_SEARCH_GLOBAL_IGNORE_PROMPTED, true, PreferenceScope.User);
  }

  private startMap = async (regenerate: boolean): Promise<void> => {
    const root = this.root();
    if (!root) return;
    await this.maybePromptGlobalIgnore();
    // Runs the local model over the codebase — no cost, so it starts directly.
    void this.service.startDescriptionJob(root, { regenerate });
  };

  private pauseMap = (): void => {
    const root = this.root();
    if (root) void this.service.pauseDescriptionJob(root);
  };

  private resumeMap = (): void => {
    const root = this.root();
    if (root) void this.service.resumeDescriptionJob(root);
  };

  private onDescriptionUpdate(u: DescriptionUpdate): void {
    if (!this.aiPending.has(u.path) && !this.aiText.has(u.path)) return; // stale
    if (!u.failed) this.aiText.set(u.path, u.text);
    if (u.done) {
      this.aiPending.delete(u.path);
      this.aiDone++;
    }
    this.update();
  }

  private onInput = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.query = e.target.value;
    this.runSearch(this.query);
    this.update();
  };

  private onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.query = "";
      this.hits = [];
      this.resetAiState();
      this.activeFilters.clear();
      this.runSearch.cancel();
      this.update();
    }
  };

  private openHit = (hit: SearchHit): void => {
    const rootResource = this.workspace.tryGetRoots()[0]?.resource;
    if (!rootResource) return;
    const uri = rootResource.resolve(hit.path);
    void open(this.openerService, uri);
    void this.commands.executeCommand("navigator.reveal", uri).catch(() => undefined);
  };

  private toggleFilter = (cat: string): void => {
    if (this.activeFilters.has(cat)) {
      this.activeFilters.delete(cat);
    } else {
      this.activeFilters.add(cat);
    }
    this.update();
  };

  private renderIndexingProgress(): React.ReactNode {
    const { indexed, total } = this.status;
    const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;
    const elapsed = this.indexingStart !== undefined ? Date.now() - this.indexingStart : 0;
    const msgIndex = Math.floor(elapsed / 10000) % INDEXING_MESSAGES.length;
    const msg = INDEXING_MESSAGES[msgIndex];
    return (
      <div className="spexr-smart-search__progress">
        <div className="spexr-smart-search__progress-track">
          <div
            className="spexr-smart-search__progress-fill"
            style={{ width: `${Math.max(pct, total === 0 ? 8 : 2)}%` }}
          />
        </div>
        <div className="spexr-smart-search__progress-meta">
          <span className="spexr-smart-search__progress-count">
            {total > 0 ? `${indexed} / ${total}` : "Indexing…"}
          </span>
          <span className="spexr-smart-search__progress-msg">{msg}</span>
        </div>
      </div>
    );
  }

  private renderHit(hit: SearchHit): React.ReactNode {
    const color = categoryColor(hit.category);
    return (
      <li key={hit.path} className="spexr-smart-search__hit" title={hit.path} onClick={() => this.openHit(hit)}>
        <div className="spexr-smart-search__hit-head">
          <span className="spexr-smart-search__hit-name">{basename(hit.path)}</span>
          <span className="spexr-smart-search__hit-chip" style={{ color, borderColor: color }}>
            {CATEGORY_LABELS[hit.category] ?? hit.category}
          </span>
          <span className="spexr-smart-search__hit-score" style={{ color: scoreColor(hit.score) }}>{formatScore(hit.score)}</span>
        </div>
        {this.renderDesc(hit)}
        <div className="spexr-smart-search__hit-path">{dirname(hit.path)}</div>
      </li>
    );
  }

  private renderDesc(hit: SearchHit): React.ReactNode {
    const ai = this.aiText.get(hit.path);
    const pending = this.aiPending.has(hit.path);
    // While the AI description is generating, show a skeleton where it will land
    // instead of a placeholder or the weaker static text.
    if (pending && this.aiEnabled()) {
      return (
        <div className="spexr-smart-search__hit-desc">
          <span className="spexr-smart-search__ai-icon spexr-smart-search__ai-icon--pulsing" title="L'AI sta generando una descrizione del file…">✦</span>
          <span className="spexr-smart-search__desc-skeleton" aria-hidden="true">
            <span className="spexr-smart-search__skeleton-line" />
            <span className="spexr-smart-search__skeleton-line spexr-smart-search__skeleton-line--short" />
          </span>
        </div>
      );
    }
    const text = (ai && ai.length > 0 ? ai : undefined) ?? hit.description;
    if (!text) return null;
    const showIcon = this.aiEnabled() && ai !== undefined;
    return (
      <div className="spexr-smart-search__hit-desc">
        {showIcon && <span className="spexr-smart-search__ai-icon" title="Descrizione generata dall'AI">✦</span>}
        <span className="spexr-smart-search__desc-text">{text}</span>
      </div>
    );
  }

  private renderFilters(): React.ReactNode {
    if (this.hits.length === 0) return null;
    const cats = [...new Set(this.hits.map((h) => h.category))];
    if (cats.length <= 1) return null;
    return (
      <div className="spexr-smart-search__filters">
        {cats.map((cat) => {
          const active = this.activeFilters.has(cat);
          const color = categoryColor(cat);
          const count = this.hits.filter((h) => h.category === cat).length;
          return (
            <button
              key={cat}
              className={`spexr-smart-search__filter-chip${active ? " spexr-smart-search__filter-chip--active" : ""}`}
              style={{ "--cat-color": color } as React.CSSProperties}
              onClick={() => this.toggleFilter(cat)}
            >
              {CATEGORY_LABELS[cat] ?? cat}
              <span className="spexr-smart-search__filter-count">{count}</span>
            </button>
          );
        })}
      </div>
    );
  }

  private renderResults(): React.ReactNode {
    if (this.hits.length === 0) {
      return <ul className="spexr-smart-search__results"><li className="spexr-smart-search__empty">No results</li></ul>;
    }
    const displayed = this.activeFilters.size > 0
      ? this.hits.filter((h) => this.activeFilters.has(h.category))
      : this.hits;
    return (
      <ul className="spexr-smart-search__results">
        {displayed.length === 0
          ? <li className="spexr-smart-search__empty">No results in selected categories</li>
          : displayed.map((hit) => this.renderHit(hit))
        }
      </ul>
    );
  }

  protected render(): React.ReactNode {
    return (
      <div className="spexr-smart-search__body">
        {this.renderMapHeader()}
        <input
          className="spexr-smart-search__input theia-input"
          placeholder="Search files by meaning…"
          value={this.query}
          onChange={this.onInput}
          onKeyDown={this.onKeyDown}
        />
        {this.status.state === "indexing"
          ? this.renderIndexingProgress()
          : this.status.state === "ready"
            ? null
            : <div className="spexr-smart-search__status">{statusLabel(this.status)}</div>
        }
        {this.query.trim().length > 0 && this.renderAiProgress()}
        {this.query.trim().length > 0 && this.renderFilters()}
        {this.query.trim().length > 0 && this.renderResults()}
      </div>
    );
  }

  private renderMapHeader(): React.ReactNode {
    const { state, done, total } = this.jobStatus;
    const running = state === "running";
    const paused = state === "paused";
    const idle = !running && !paused;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const label = running ? "Pause" : paused ? "Resume" : "Understand the codebase";
    const onClick = running ? this.pauseMap : paused ? this.resumeMap : () => void this.startMap(false);
    const title = running
      ? "Pause understanding"
      : paused
        ? "Resume understanding"
        : "Generate AI descriptions for the whole codebase using the local model";
    return (
      <div className="spexr-smart-search__map">
        <div className="spexr-smart-search__map-row">
          <button className="spexr-smart-search__map-cta" onClick={onClick} title={title}>
            <span className="spexr-smart-search__map-glyph" aria-hidden="true">✦</span>
            <span className="spexr-smart-search__map-label">{label}</span>
          </button>
        </div>
        {idle && (
          <div className="spexr-smart-search__map-sub">
            <span>Summarize every file, on-device</span>
            <button
              className="spexr-smart-search__map-regen"
              onClick={() => void this.startMap(true)}
              title="Regenerate all descriptions"
              aria-label="Regenerate all descriptions"
            >
              <span className="codicon codicon-refresh" aria-hidden />
            </button>
          </div>
        )}
        {(running || paused) && (
          <div className="spexr-smart-search__map-progress">
            <span className="spexr-smart-search__map-track">
              <span className="spexr-smart-search__map-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="spexr-smart-search__map-count">{done}/{total}</span>
          </div>
        )}
        {state === "error" && (
          <div className="spexr-smart-search__map-error">{this.jobStatus.message ?? "Understanding failed."}</div>
        )}
      </div>
    );
  }

  private renderAiProgress(): React.ReactNode {
    // Indeterminate: a batch runs as a single inference, so per-file percentage
    // is meaningless — show motion until everything resolves, not a fill level.
    if (!this.aiEnabled() || this.aiTotal === 0 || this.aiDone >= this.aiTotal) return null;
    return (
      <div className="spexr-smart-search__ai-progress">
        <span className="spexr-smart-search__ai-icon spexr-smart-search__ai-icon--pulsing">✦</span>
        <span>Generating AI descriptions…</span>
        <span className="spexr-smart-search__ai-progress-track">
          <span className="spexr-smart-search__ai-progress-fill" />
        </span>
      </div>
    );
  }
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i + 1);
}
