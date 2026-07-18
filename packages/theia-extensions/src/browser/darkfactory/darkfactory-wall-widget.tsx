import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { ApplicationShell } from "@theia/core/lib/browser";
import type { AgentSummary, AgentTile, FollowEvent, SpexrDarkfactoryService } from "../../common/darkfactory-protocol.js";
import { SpexrDarkfactoryServiceProxy } from "./darkfactory-service-proxy.js";
import { SpexrDarkfactoryClientDispatcher } from "./darkfactory-client.js";
import { SpexrDarkfactoryTerminalManager } from "./darkfactory-terminal-manager.js";
import { SpexrDarkfactoryFollowWidget } from "./follow-pane.js";
import { sortTiles } from "./darkfactory-format.js";
import { AgentTileCard, AgentCondensedRow, AgentPinnedCard } from "./agent-tile.js";

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

/** Machine-wide monitoring wall of every Claude Code session ("agent"). */
@injectable()
export class SpexrDarkfactoryWidget extends ReactWidget {
  static readonly ID = "spexr.view.darkfactory";

  @inject(SpexrDarkfactoryServiceProxy) private readonly service!: SpexrDarkfactoryService;
  @inject(SpexrDarkfactoryClientDispatcher) private readonly client!: SpexrDarkfactoryClientDispatcher;
  @inject(SpexrDarkfactoryTerminalManager) private readonly terminals!: SpexrDarkfactoryTerminalManager;
  @inject(SpexrDarkfactoryFollowWidget) private readonly followPane!: SpexrDarkfactoryFollowWidget;
  @inject(ApplicationShell) private readonly shell!: ApplicationShell;

  private tiles: AgentTile[] = [];
  /** sessionId → AI summary state, filled asynchronously and refreshed for live sessions. */
  private readonly summaries = new Map<string, SummaryState>();
  /** Sessions awaiting a summary; drained one inference at a time by {@link drainSummaries}. */
  private readonly summaryQueue: string[] = [];
  private summaryRunning = false;

  /** The session lifted into the expanded pinned card, with its live follow buffer. */
  private pinnedSessionId: string | undefined;
  private pinnedEvents: FollowEvent[] = [];

  @postConstruct()
  protected init(): void {
    this.id = SpexrDarkfactoryWidget.ID;
    this.title.label = "Darkfactory";
    this.title.caption = "All Claude agents at work";
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
    this.toDispose.push({ dispose: () => this.stopFollow() });
    this.refresh().catch(() => {
      /* ignore */
    });
  }

  /** Lift a session into the pinned card and start its read-only live follow (toggles off if already pinned). */
  private pin(tile: AgentTile): void {
    if (this.pinnedSessionId === tile.sessionId) {
      this.unpin();
      return;
    }
    this.stopFollow();
    this.pinnedSessionId = tile.sessionId;
    this.pinnedEvents = [];
    this.update();
    void this.service.startFollow(tile.sessionId).catch(() => {
      /* ignore */
    });
  }

  private unpin(): void {
    this.stopFollow();
    this.pinnedSessionId = undefined;
    this.pinnedEvents = [];
    this.update();
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
    const now = Date.now();
    const tiles = sortTiles(this.tiles);
    if (tiles.length === 0) {
      return (
        <div className="spexr-df-empty">No Claude agents found. Start a session to see it here.</div>
      );
    }
    const pin = (tile: AgentTile): void => this.pin(tile);
    const openTerminal = (tile: AgentTile): void =>
      void this.openFocus(tile).catch(() => {
        /* ignore */
      });
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
            onClose={() => this.unpin()}
            onOpenTerminal={openTerminal}
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

  /** Open a tile in the focus pane: an interactive resume terminal, or a read-only follow. */
  protected async openFocus(tile: AgentTile): Promise<void> {
    const plan = await this.service.planFocus(tile.sessionId);
    if (plan.kind === "resume-terminal") {
      await this.terminals.openResume(plan.sessionId, plan.projectPath, plan.configDir, false);
      return;
    }
    await this.followPane.follow(plan.sessionId, plan.projectPath, plan.configDir, tile.projectName);
    await this.shell.addWidget(this.followPane, { area: "main" });
    await this.shell.activateWidget(this.followPane.id);
  }
}
