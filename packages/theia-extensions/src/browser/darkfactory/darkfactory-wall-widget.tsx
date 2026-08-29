import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import type { AgentSummary, AgentTile, FollowEvent, SpexrDarkfactoryService } from "../../common/darkfactory-protocol.js";
import { SpexrDarkfactoryServiceProxy } from "./darkfactory-service-proxy.js";
import { SpexrDarkfactoryClientDispatcher } from "./darkfactory-client.js";
import { SpexrDarkfactoryTerminalManager } from "./darkfactory-terminal-manager.js";
import { sortTiles } from "./darkfactory-format.js";
import { AgentTileCard, AgentCondensedRow, AgentPinnedCard } from "./agent-tile.js";
import { DARKFACTORY_VIEW_ID } from "./darkfactory-view-id.js";

/** How many top-priority sessions render as full cards; the rest are condensed rows. */
const CARD_LIMIT = 10;

/**
 * How many top sessions get an AI summary. Each summary is a ~13s local-model
 * inference (in a separate worker process), so keep this small.
 */
const SUMMARY_EAGER = 5;

/**
 * Floor between two refreshes of the same working session. Not a fixed cadence —
 * refreshes are driven by *what changed* (see {@link shouldRefresh}); this only
 * stops one churning session from monopolizing the single model and starving the
 * others. Small, so supervision stays near real-time.
 */
const MIN_REFRESH_GAP_MS = 10_000;

/** Cap the pinned follow buffer so a long-running session cannot grow it without bound. */
const FOLLOW_BUFFER = 400;

const EMPTY_SUMMARY: AgentSummary = { now: "", overview: "" };

/** Cached summary plus the snapshot that decides when it is worth re-inferring. */
interface SummaryState {
  summary: AgentSummary;
  /** Show the "Summarizing…" placeholder — only on the first compute, so a refresh keeps the old text. */
  loading: boolean;
  /** Session mtime this summary reflects. */
  mtime: number;
  /** User-turn count when summarized — a new turn is a new instruction, worth a refresh. */
  turnCount: number;
  /** Distilled action when summarized — a changed action means the agent moved on. */
  action: string;
  /** Timestamp of the last request/completion; anchors the {@link MIN_REFRESH_GAP_MS} floor. */
  at: number;
}

/**
 * A working session is worth re-summarizing when the agent has meaningfully moved
 * — a new user turn, or a different distilled action — not merely because the
 * transcript grew (streamed text, repeated same-tool calls). The floor keeps the
 * single model fair across sessions.
 */
function shouldRefresh(tile: AgentTile, cur: SummaryState, now: number): boolean {
  if (tile.state !== "working") return false;
  if (now - cur.at < MIN_REFRESH_GAP_MS) return false;
  return tile.turnCount > cur.turnCount || tile.actionLine !== cur.action;
}

/** Machine-wide monitoring wall of every agent session (Claude Code, opencode). */
@injectable()
export class SpexrDarkfactoryWidget extends ReactWidget {
  static readonly ID = DARKFACTORY_VIEW_ID;

  @inject(SpexrDarkfactoryServiceProxy) private readonly service!: SpexrDarkfactoryService;
  @inject(SpexrDarkfactoryClientDispatcher) private readonly client!: SpexrDarkfactoryClientDispatcher;
  @inject(SpexrDarkfactoryTerminalManager) private readonly terminals!: SpexrDarkfactoryTerminalManager;

  private tiles: AgentTile[] = [];
  /** False until the first tile snapshot lands — the wall shows a loading state until then. */
  private loaded = false;
  /** sessionId → AI summary state, filled asynchronously and refreshed for live sessions. */
  private readonly summaries = new Map<string, SummaryState>();
  /** Sessions awaiting a summary; drained one inference at a time by {@link drainSummaries}. */
  private readonly summaryQueue: string[] = [];
  private summaryRunning = false;

  /** The session lifted into the expanded pinned card. */
  private pinnedSessionId: string | undefined;
  /** Read-only follow buffer (used when the pinned session has no interactive terminal). */
  private pinnedEvents: FollowEvent[] = [];
  /** Interactive resume/fork terminal embedded in the pinned card, when applicable. */
  private pinnedTerminal: TerminalWidget | undefined;

  @postConstruct()
  protected init(): void {
    this.id = SpexrDarkfactoryWidget.ID;
    this.title.label = "Darkfactory";
    this.title.caption = "All agent sessions at work";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-server-process";
    this.addClass("spexr-darkfactory");
    this.toDispose.push(this.client.onTilesChanged$((tiles) => this.setTiles(tiles)));
    this.toDispose.push(
      this.client.onFollowChunk$(({ sessionId, events }) => {
        if (sessionId !== this.pinnedSessionId) return;
        this.pinnedEvents = [...this.pinnedEvents, ...events].slice(-FOLLOW_BUFFER);
        this.update();
      }),
    );
    this.toDispose.push({ dispose: () => this.clearPinned() });
    // ReactWidget renders only on update() — paint the loading state now, before
    // the first tiles land (without this the widget body stays blank until then).
    this.update();
    this.refresh().catch(() => {
      // Scan failed — stop the spinner and fall through to the empty state.
      this.loaded = true;
      this.update();
    });
  }

  /**
   * Lift a session into the pinned card (toggles off if already pinned). A
   * resumable (idle, own config dir) session opens an interactive terminal in the
   * card; a live-elsewhere session opens a read-only follow with a Fork & continue
   * action. planFocus decides.
   */
  private pin(tile: AgentTile): void {
    if (this.pinnedSessionId === tile.sessionId) {
      this.unpin();
      return;
    }
    this.clearPinned();
    this.pinnedSessionId = tile.sessionId;
    this.pinnedEvents = [];
    this.update();
    void this.openPinned(tile).catch(() => {
      /* ignore */
    });
  }

  private async openPinned(tile: AgentTile): Promise<void> {
    const plan = await this.service.planFocus(tile.sessionId);
    if (this.pinnedSessionId !== tile.sessionId) return; // pin changed while awaiting
    if (plan.kind === "resume-terminal") {
      const term = await this.terminals.openEmbedded(plan.sessionId, plan.projectPath, plan.configDir, false);
      if (this.pinnedSessionId !== tile.sessionId) {
        term?.dispose();
        return;
      }
      this.pinnedTerminal = term;
      this.update();
    } else {
      await this.service.startFollow(tile.sessionId).catch(() => {
        /* ignore */
      });
    }
  }

  /** Fork a live session into a writable terminal embedded in the pinned card. */
  private forkTakeover(tile: AgentTile): void {
    void (async () => {
      const plan = await this.service.planFocus(tile.sessionId);
      const term = await this.terminals.openEmbedded(plan.sessionId, plan.projectPath, plan.configDir, true);
      if (this.pinnedSessionId !== tile.sessionId) {
        term?.dispose();
        return;
      }
      this.stopFollow();
      this.pinnedTerminal = term;
      this.update();
    })().catch(() => {
      /* ignore */
    });
  }

  private unpin(): void {
    this.clearPinned();
    this.pinnedSessionId = undefined;
    this.pinnedEvents = [];
    this.update();
  }

  /** Tear down the pinned session's follow and embedded terminal (keeps pinnedSessionId untouched). */
  private clearPinned(): void {
    this.stopFollow();
    this.pinnedTerminal?.dispose();
    this.pinnedTerminal = undefined;
  }

  private stopFollow(): void {
    const id = this.pinnedSessionId;
    if (id) {
      void this.service.stopFollow(id).catch(() => {
        /* ignore */
      });
    }
  }

  private async refresh(): Promise<void> {
    this.setTiles(await this.service.listTiles());
  }

  private setTiles(tiles: AgentTile[]): void {
    this.tiles = tiles;
    this.loaded = true;
    this.update();
    // Drop cached descriptions for sessions no longer on the wall (no unbounded growth).
    const live = new Set(tiles.map((t) => t.sessionId));
    for (const id of this.summaries.keys()) {
      if (!live.has(id)) this.summaries.delete(id);
    }
    // Drop the pinned card if its session is gone (stops the orphaned follow).
    if (this.pinnedSessionId && !live.has(this.pinnedSessionId)) this.unpin();
    // First compute for a newly-seen session; then keep a WORKING session's summary
    // fresh, but only when the agent has meaningfully moved (see shouldRefresh).
    // Idle/done sessions are computed once.
    const now = Date.now();
    for (const t of sortTiles(tiles).slice(0, SUMMARY_EAGER)) {
      const cur = this.summaries.get(t.sessionId);
      if (!cur) {
        this.enqueueSummary(t, true);
        continue;
      }
      if (shouldRefresh(t, cur, now) && !this.summaryQueue.includes(t.sessionId)) {
        this.enqueueSummary(t, false);
      }
    }
    void this.drainSummaries();
  }

  /** Queue a session for (re)summarizing. `firstCompute` shows the placeholder; a refresh keeps the old text. */
  private enqueueSummary(tile: AgentTile, firstCompute: boolean): void {
    const cur = this.summaries.get(tile.sessionId);
    this.summaries.set(tile.sessionId, {
      summary: cur?.summary ?? EMPTY_SUMMARY,
      loading: firstCompute,
      mtime: tile.lastActivityMs,
      turnCount: tile.turnCount,
      action: tile.actionLine,
      at: Date.now(),
    });
    if (!this.summaryQueue.includes(tile.sessionId)) this.summaryQueue.push(tile.sessionId);
  }

  /** Compute queued summaries one inference at a time (the model is serialized anyway). */
  private async drainSummaries(): Promise<void> {
    if (this.summaryRunning) return;
    this.summaryRunning = true;
    try {
      let id: string | undefined;
      while ((id = this.summaryQueue.shift()) !== undefined) {
        const pending = this.summaries.get(id);
        if (!pending) continue; // session left the wall
        const summary = await this.service.summarize(id).catch((): AgentSummary => EMPTY_SUMMARY);
        const prev = this.summaries.get(id);
        if (!prev) continue; // pruned while inferring
        // Anchor the floor on completion so a slow inference does not immediately re-fire.
        this.summaries.set(id, { ...prev, summary, loading: false, at: Date.now() });
        this.update();
      }
    } finally {
      this.summaryRunning = false;
    }
  }

  protected render(): React.ReactNode {
    if (!this.loaded) {
      return (
        <div className="spexr-df-loading">
          <i className="codicon codicon-loading codicon-modifier-spin" />
          Scanning agent sessions…
        </div>
      );
    }
    const now = Date.now();
    const tiles = sortTiles(this.tiles);
    if (tiles.length === 0) {
      return (
        <div className="spexr-df-empty">No agent sessions found. Start a Claude or opencode session to see it here.</div>
      );
    }
    const pin = (tile: AgentTile): void => this.pin(tile);
    // The pinned session is lifted out of the grid; the rest keep their order below.
    const pinned = this.pinnedSessionId
      ? tiles.find((t) => t.sessionId === this.pinnedSessionId)
      : undefined;
    const rest = pinned ? tiles.filter((t) => t.sessionId !== pinned.sessionId) : tiles;
    const cards = rest.slice(0, CARD_LIMIT);
    const condensed = rest.slice(CARD_LIMIT);
    return (
      <div className="spexr-df-root">
        {pinned && (
          <AgentPinnedCard
            tile={pinned}
            now={now}
            summary={this.summaries.get(pinned.sessionId)}
            events={this.pinnedEvents}
            terminal={this.pinnedTerminal}
            onClose={() => this.unpin()}
            onFork={(t) => this.forkTakeover(t)}
          />
        )}
        <div className="spexr-df-grid">
          {cards.map((t) => (
            <AgentTileCard
              key={t.sessionId}
              tile={t}
              now={now}
              summary={this.summaries.get(t.sessionId)}
              onOpen={pin}
            />
          ))}
        </div>
        {condensed.length > 0 && (
          <div className="spexr-df-condensed">
            <div className="spexr-df-condensed__label">{condensed.length} more</div>
            {condensed.map((t) => (
              <AgentCondensedRow key={t.sessionId} tile={t} now={now} onOpen={pin} />
            ))}
          </div>
        )}
      </div>
    );
  }
}
