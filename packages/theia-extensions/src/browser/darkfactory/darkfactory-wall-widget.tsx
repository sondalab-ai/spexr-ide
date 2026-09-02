import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import type { AgentSummary, AgentTile, FollowEvent, SpexrDarkfactoryService } from "../../common/darkfactory-protocol.js";
import { SpexrDarkfactoryServiceProxy } from "./darkfactory-service-proxy.js";
import { SpexrDarkfactoryClientDispatcher } from "./darkfactory-client.js";
import { SpexrDarkfactoryTerminalManager } from "./darkfactory-terminal-manager.js";
import { SpexrProjectSwitchService } from "../project/spexr-project-switch-service.js";
import { sortTiles, groupTiles, summaryTargets } from "./darkfactory-format.js";
import type { TileGroup } from "./darkfactory-format.js";
import { AgentTileCard, AgentCondensedRow, AgentPinnedCard, AgentGroupHeader } from "./agent-tile.js";
import { DARKFACTORY_VIEW_ID } from "./darkfactory-view-id.js";

/** How many top-priority sessions render as full cards; the rest are condensed rows. */
const CARD_LIMIT = 10;

/**
 * How many project groups render their sessions as full cards. Past this the
 * remaining projects are still listed, but condensed — the card budget is spent
 * per project rather than globally, so a project is never split between the grid
 * and the tail.
 */
const GROUP_CARD_LIMIT = 4;

/**
 * How many top sessions get an AI summary, before the per-group heads are added
 * (see {@link summaryTargets}). Each summary is a ~13s local-model inference (in a
 * separate worker process), so keep this small.
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
  @inject(SpexrProjectSwitchService) private readonly projectSwitch!: SpexrProjectSwitchService;

  private tiles: AgentTile[] = [];
  /** False until the first tile snapshot lands — the wall shows a loading state until then. */
  private loaded = false;
  /** sessionId → AI summary state, filled asynchronously and refreshed for live sessions. */
  private readonly summaries = new Map<string, SummaryState>();
  /** Sessions awaiting a summary; drained one inference at a time by {@link drainSummaries}. */
  private readonly summaryQueue: string[] = [];
  private summaryRunning = false;

  /** Project paths the user has shut; groups are open by default and this is not persisted. */
  private readonly collapsedGroups = new Set<string>();

  /**
   * Sessions lifted into expanded cards, newest first — several can be open at
   * once, each keeping its own terminal alive. The embedded terminal is not held
   * here: the manager owns one per session and {@link SpexrDarkfactoryTerminalManager.live}
   * is the single source of truth for whether a card has one.
   */
  private pinned: string[] = [];
  /** Per-pinned-session read-only follow buffer, for the cards with no terminal. */
  private readonly pinnedEvents = new Map<string, FollowEvent[]>();

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
        const buffered = this.pinnedEvents.get(sessionId);
        if (!buffered) return;
        this.pinnedEvents.set(sessionId, [...buffered, ...events].slice(-FOLLOW_BUFFER));
        this.update();
      }),
    );
    this.toDispose.push({ dispose: () => this.stopAllFollows() });
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
   * Lift a session into an expanded card (toggles off if already expanded). A
   * resumable (idle, own config dir) session opens an interactive terminal in the
   * card; a live-elsewhere session opens a read-only follow with a Fork & continue
   * action. planFocus decides. Cards stack newest first, and opening one leaves
   * every other card, and its session, exactly as it was.
   */
  private pin(tile: AgentTile): void {
    if (this.pinned.includes(tile.sessionId)) {
      this.unpin(tile.sessionId);
      return;
    }
    this.pinned = [tile.sessionId, ...this.pinned];
    this.pinnedEvents.set(tile.sessionId, []);
    this.update();
    void this.openPinned(tile).catch(() => {
      /* ignore */
    });
  }

  private async openPinned(tile: AgentTile): Promise<void> {
    // A terminal we already opened for this session is the session: re-attach it
    // rather than planning again. planFocus would answer "readonly-follow",
    // because that very terminal is what makes the session look live.
    if (this.terminals.live(tile.sessionId)) {
      this.update();
      return;
    }
    const plan = await this.service.planFocus(tile.sessionId);
    if (!this.pinned.includes(tile.sessionId)) return; // card closed while awaiting
    if (plan.kind === "resume-terminal") {
      await this.terminals.openEmbedded(plan.sessionId, plan.projectPath, plan.configDir, false);
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
      await this.terminals.openEmbedded(plan.sessionId, plan.projectPath, plan.configDir, true);
      this.stopFollow(tile.sessionId);
      this.update();
    })().catch(() => {
      /* ignore */
    });
  }

  /**
   * Load a tile's project in this window. Kept separate from {@link pin}: pinning
   * drives the session in place, this repoints the whole workspace and costs a
   * window reload.
   */
  private openProject(tile: AgentTile): void {
    this.projectSwitch.switchTo(tile.projectPath);
  }

  /**
   * Close one expanded card. The embedded terminal is deliberately NOT disposed:
   * disposing closes the backend terminal, which kills the agent process and
   * loses the session's work. It stays with the manager, detached, ready to be
   * shown again.
   */
  private unpin(sessionId: string): void {
    // The session drops back into its group — open it, or the tile just vanishes.
    const tile = this.tiles.find((t) => t.sessionId === sessionId);
    if (tile) this.collapsedGroups.delete(tile.projectPath);
    this.stopFollow(sessionId);
    this.pinned = this.pinned.filter((id) => id !== sessionId);
    this.pinnedEvents.delete(sessionId);
    this.update();
  }

  private stopFollow(sessionId: string): void {
    void this.service.stopFollow(sessionId).catch(() => {
      /* ignore */
    });
  }

  private stopAllFollows(): void {
    for (const id of this.pinned) this.stopFollow(id);
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
    const liveProjects = new Set(tiles.map((t) => t.projectPath));
    for (const path of this.collapsedGroups) {
      if (!liveProjects.has(path)) this.collapsedGroups.delete(path);
    }
    // Drop expanded cards whose session is gone (stops the orphaned follow).
    for (const id of this.pinned) {
      if (!live.has(id)) this.unpin(id);
    }
    // First compute for a newly-seen session; then keep a WORKING session's summary
    // fresh, but only when the agent has meaningfully moved (see shouldRefresh).
    // Idle/done sessions are computed once.
    const now = Date.now();
    const byId = new Map(tiles.map((t) => [t.sessionId, t]));
    const targets = summaryTargets(
      tiles,
      this.projectSwitch.currentProjectPath(),
      SUMMARY_EAGER,
      GROUP_CARD_LIMIT,
    );
    for (const id of targets) {
      const t = byId.get(id);
      if (!t) continue;
      const cur = this.summaries.get(id);
      if (!cur) {
        this.enqueueSummary(t, true);
        continue;
      }
      if (shouldRefresh(t, cur, now) && !this.summaryQueue.includes(id)) {
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

  /** Open or shut one project group. */
  private toggleGroup(projectPath: string): void {
    if (this.collapsedGroups.has(projectPath)) this.collapsedGroups.delete(projectPath);
    else this.collapsedGroups.add(projectPath);
    this.update();
  }

  private renderCard(tile: AgentTile, now: number, showProject: boolean): React.ReactNode {
    return (
      <AgentTileCard
        key={tile.sessionId}
        tile={tile}
        now={now}
        summary={this.summaries.get(tile.sessionId)}
        onOpen={(t) => this.pin(t)}
        onOpenProject={(t) => this.openProject(t)}
        isCurrent={this.projectSwitch.isCurrentProject(tile.projectPath)}
        showProject={showProject}
      />
    );
  }

  private renderRow(tile: AgentTile, now: number, showProject: boolean): React.ReactNode {
    return (
      <AgentCondensedRow
        key={tile.sessionId}
        tile={tile}
        now={now}
        onOpen={(t) => this.pin(t)}
        isCurrent={this.projectSwitch.isCurrentProject(tile.projectPath)}
        showProject={showProject}
      />
    );
  }

  /** Ungrouped wall: one project's sessions need no headers to tell them apart. */
  private renderFlat(tiles: AgentTile[], now: number): React.ReactNode {
    const condensed = tiles.slice(CARD_LIMIT);
    return (
      <>
        <div className="spexr-df-grid">{tiles.slice(0, CARD_LIMIT).map((t) => this.renderCard(t, now, true))}</div>
        {condensed.length > 0 && (
          <div className="spexr-df-condensed">
            <div className="spexr-df-condensed__label">{condensed.length} more</div>
            {condensed.map((t) => this.renderRow(t, now, true))}
          </div>
        )}
      </>
    );
  }

  /**
   * One project's sessions under their own header. Groups past
   * {@link GROUP_CARD_LIMIT} stay visible as condensed rows rather than dropping
   * to a nameless tail.
   */
  private renderGroup(group: TileGroup, index: number, now: number): React.ReactNode {
    const collapsed = this.collapsedGroups.has(group.projectPath);
    const asCards = index < GROUP_CARD_LIMIT;
    const cards = asCards ? group.tiles.slice(0, CARD_LIMIT) : [];
    const condensed = asCards ? group.tiles.slice(CARD_LIMIT) : group.tiles;
    return (
      <section className="spexr-df-group" key={group.projectPath} data-collapsed={collapsed}>
        <AgentGroupHeader
          group={group}
          collapsed={collapsed}
          onToggle={(path) => this.toggleGroup(path)}
          onOpenProject={(t) => this.openProject(t)}
        />
        {!collapsed && cards.length > 0 && (
          <div className="spexr-df-grid">{cards.map((t) => this.renderCard(t, now, false))}</div>
        )}
        {!collapsed && condensed.length > 0 && (
          <div className="spexr-df-condensed">{condensed.map((t) => this.renderRow(t, now, false))}</div>
        )}
      </section>
    );
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
    // Expanded sessions are lifted out of the grid, in the order they were
    // opened; the rest keep their own order below.
    const byId = new Map(tiles.map((t) => [t.sessionId, t]));
    const expanded = this.pinned.flatMap((id) => {
      const tile = byId.get(id);
      return tile ? [tile] : [];
    });
    const rest = tiles.filter((t) => !this.pinned.includes(t.sessionId));
    // Headers earn their space only once there is more than one project to tell apart.
    const groups = groupTiles(rest, this.projectSwitch.currentProjectPath());
    return (
      <div className="spexr-df-root">
        {expanded.map((tile) => (
          <AgentPinnedCard
            key={tile.sessionId}
            tile={tile}
            now={now}
            summary={this.summaries.get(tile.sessionId)}
            events={this.pinnedEvents.get(tile.sessionId) ?? []}
            terminal={this.terminals.live(tile.sessionId)}
            onClose={() => this.unpin(tile.sessionId)}
            onFork={(t) => this.forkTakeover(t)}
            onOpenProject={(t) => this.openProject(t)}
            isCurrent={this.projectSwitch.isCurrentProject(tile.projectPath)}
          />
        ))}
        {groups.length > 1
          ? groups.map((g, i) => this.renderGroup(g, i, now))
          : this.renderFlat(rest, now)}
      </div>
    );
  }
}
