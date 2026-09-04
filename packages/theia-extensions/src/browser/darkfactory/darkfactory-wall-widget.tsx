import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import URI from "@theia/core/lib/common/uri";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { FileDialogService } from "@theia/filesystem/lib/browser/file-dialog";
import type {
  AgentSummary,
  AgentTile,
  ClaudeConfigDir,
  FollowEvent,
  SpexrDarkfactoryService,
} from "../../common/darkfactory-protocol.js";
import { SpexrDarkfactoryServiceProxy } from "./darkfactory-service-proxy.js";
import { SpexrDarkfactoryClientDispatcher } from "./darkfactory-client.js";
import { SpexrDarkfactoryTerminalManager } from "./darkfactory-terminal-manager.js";
import { SpexrProjectSwitchService } from "../project/spexr-project-switch-service.js";
import { normalizeProjectPath } from "../project/project-switch-targets.js";
import { sortTiles, groupTiles, summaryTargets, launchTargets } from "./darkfactory-format.js";
import type { TileGroup } from "./darkfactory-format.js";
import {
  AgentTileCard,
  AgentCondensedRow,
  AgentPinnedCard,
  AgentGroupHeader,
  NewSessionLauncher,
  LaunchedSessionCard,
} from "./agent-tile.js";
import { matchLaunchedSession } from "./new-session-match.js";
import { routeWheel, wheelDeltaPx } from "./wheel-routing.js";
import { mosaicColumns, readWallLayout, writeWallLayout, type WallLayout } from "./wall-layout.js";
import type { HarnessId } from "../../common/harness/harness-types.js";
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
  @inject(WorkspaceService) private readonly workspace!: WorkspaceService;
  @inject(FileService) private readonly files!: FileService;
  @inject(FileDialogService) private readonly fileDialog!: FileDialogService;

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

  /**
   * Sessions started from the launcher, still keyed by a placeholder: a new
   * session has no id until its harness writes a transcript. `knownBefore` is
   * what the wall knew at launch, which is how {@link matchLaunchedSession}
   * recognises the session once it appears.
   */
  private launched: {
    key: string;
    projectPath: string;
    projectName: string;
    harness: HarnessId;
    knownBefore: ReadonlySet<string>;
  }[] = [];
  private launchCounter = 0;

  /** When the wheel last scrolled the wall, anchoring {@link routeWheel}'s gesture window. */
  private lastWallWheelAt = 0;

  /**
   * Claude accounts a new session can start under. Discovered once by the
   * backend — the set only changes when the user adds a config dir, which costs
   * a restart anyway.
   */
  private configs: ClaudeConfigDir[] = [];

  /**
   * Recent workspace roots, as filesystem paths. They are what lets the launcher
   * start a session in a project that has none running — the wall alone can only
   * offer projects an agent is already working in.
   */
  private recentProjects: string[] = [];

  /**
   * How the cards holding a live terminal are arranged; remembered across
   * windows. Named `wallLayout` because Lumino's `Widget.layout` is taken.
   */
  private wallLayout: WallLayout = readWallLayout(window.localStorage);

  /**
   * The mosaic container, measured to decide how many columns fit. Its own width
   * is the honest one — the widget's node carries the wall's padding, and the
   * scrollbar takes a few more pixels.
   */
  private activeHost: HTMLDivElement | null = null;
  /** Watches {@link activeHost}; created on first attach, moved with the element. */
  private activeObserver?: ResizeObserver;
  /** Last measured width of {@link activeHost}; 0 until the wall is laid out. */
  private activeWidth = 0;

  @postConstruct()
  protected init(): void {
    this.id = SpexrDarkfactoryWidget.ID;
    this.title.label = "Darkfactory";
    this.title.caption = "All agent sessions at work";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-server-process";
    this.addClass("spexr-darkfactory");
    // Capture phase: an embedded terminal's own wheel listener would otherwise
    // consume the event before the wall ever sees it.
    this.node.addEventListener("wheel", this.onWheel, { capture: true, passive: false });
    this.toDispose.push({
      dispose: () => this.node.removeEventListener("wheel", this.onWheel, { capture: true }),
    });
    // The column count follows the wall's width: a narrowed window drops a column
    // rather than squeezing the terminals below what they need to be readable.
    this.activeObserver = new ResizeObserver(() => this.onActiveResize());
    this.toDispose.push({ dispose: () => this.activeObserver?.disconnect() });
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
    void this.loadRecentProjects();
    void this.service
      .listConfigDirs()
      .then((configs) => {
        this.configs = configs;
        this.update();
      })
      .catch(() => {
        // No account list — the launcher falls back to the harness default.
      });
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
   * Keep a wheel gesture on the wall once it has started there, even after a
   * terminal has slid under the pointer. The wall's own node is the scroller, so
   * taking the event over means scrolling it by hand — the browser would
   * otherwise scroll the terminal's viewport, the nearest scrollable ancestor of
   * the event's target.
   */
  private readonly onWheel = (event: WheelEvent): void => {
    const target = event.target;
    const overTerminal = target instanceof Element && target.closest(".spexr-df-termhost") !== null;
    const now = Date.now();
    if (routeWheel({ overTerminal, msSinceWallWheel: now - this.lastWallWheelAt }) === "terminal") return;
    this.lastWallWheelAt = now;
    if (!overTerminal) return; // the browser already scrolls the wall itself
    event.preventDefault();
    event.stopPropagation();
    this.node.scrollTop += wheelDeltaPx(event.deltaY, event.deltaMode, this.node.clientHeight);
  };

  /** Cards that own a terminal — the ones the mosaic has to fit side by side. */
  private activeTerminalCount(): number {
    return this.launched.length + this.pinned.length;
  }

  /** Columns for the current width and number of running terminals. */
  private mosaicColumnCount(): number {
    return mosaicColumns(this.activeWidth, this.activeTerminalCount());
  }

  /**
   * Follow the container React just mounted (or dropped). Observing the element
   * itself, rather than the widget's node, also delivers the first measurement:
   * a ResizeObserver reports the size as soon as it starts observing.
   */
  private readonly setActiveHost = (element: HTMLDivElement | null): void => {
    if (this.activeHost === element) return;
    if (this.activeHost) this.activeObserver?.unobserve(this.activeHost);
    this.activeHost = element;
    if (element) this.activeObserver?.observe(element);
  };

  /**
   * Re-measure on resize, and re-render only when the column count actually
   * changes — a drag of the window edge fires this continuously, and every
   * render is a React reconciliation over cards hosting live terminals.
   */
  private readonly onActiveResize = (): void => {
    const width = this.activeHost?.clientWidth ?? 0;
    if (width === this.activeWidth) return;
    const before = this.mosaicColumnCount();
    this.activeWidth = width;
    if (this.mosaicColumnCount() !== before) this.update();
  };

  /** Switch how the active terminal cards are arranged, and remember the choice. */
  private setLayout(layout: WallLayout): void {
    if (layout === this.wallLayout) return;
    this.wallLayout = layout;
    writeWallLayout(window.localStorage, layout);
    this.update();
  }

  /**
   * Fill {@link recentProjects} from Theia's recent workspaces. Multi-root
   * `.theia-workspace` files are dropped — they are not a directory an agent can
   * run in — and so is any root that has since been moved or deleted, because
   * offering it would start a session in a cwd that no longer exists.
   */
  private async loadRecentProjects(): Promise<void> {
    const uris = await this.workspace.recentWorkspaces().catch((): string[] => []);
    const folders = uris
      .map((uri) => new URI(uri))
      .filter((uri) => !uri.path.base.endsWith(".theia-workspace"));
    const checked = await Promise.all(
      folders.map(async (uri) =>
        (await this.files.exists(uri).catch(() => false)) ? uri.path.toString() : undefined,
      ),
    );
    this.recentProjects = checked.filter((path): path is string => path !== undefined);
    this.update();
  }

  /**
   * Ask for a folder to start in, for a project neither on the wall nor in the
   * recents. No `folder` argument: the dialog then opens on the user's working
   * directory, which is the right root for a window with no workspace loaded —
   * exactly the case this exists for.
   */
  private async browseForProject(): Promise<string | undefined> {
    const chosen = await this.fileDialog
      .showOpenDialog({
        title: "Start a session in…",
        openLabel: "Select project",
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
      })
      .catch(() => undefined);
    return chosen ? normalizeProjectPath(chosen.path.toString()) : undefined;
  }

  /**
   * Start a fresh session and lift it into a card of its own, at the head of the
   * stack. `configDir` is the Claude account it runs under — empty for opencode,
   * which has none, and for a single-account machine.
   */
  private startNewSession(raw: string, harness: HarnessId, configDir: string): void {
    // Normalized before it reaches the harness: Claude derives the name of its
    // own `projects/` directory from the cwd, so a trailing slash would give the
    // session a transcript path the scan never matches, and the placeholder card
    // would never be swapped for the real one.
    const projectPath = normalizeProjectPath(raw);
    if (!projectPath) return;
    const key = `spexr-new-${(this.launchCounter += 1)}`;
    const known = new Set(this.tiles.map((t) => t.sessionId));
    const named = this.tiles.find((t) => normalizeProjectPath(t.projectPath) === projectPath);
    this.launched = [
      ...this.launched,
      {
        key,
        projectPath,
        projectName: named?.projectName ?? projectPath.split("/").filter(Boolean).pop() ?? projectPath,
        harness,
        knownBefore: known,
      },
    ];
    this.update();
    void this.terminals
      .openNew(key, harness, projectPath, configDir)
      .then(() => this.update())
      .catch(() => {
        /* ignore */
      });
  }

  /**
   * Close a card whose session the scan has not named yet. Its terminal IS
   * disposed, unlike every other card: the placeholder key is the only handle to
   * that process, so leaving it running would strand a session the wall could
   * never re-attach — the very thing that made switching cards destructive.
   */
  private closeLaunched(key: string): void {
    this.terminals.live(key)?.dispose();
    this.launched = this.launched.filter((l) => l.key !== key);
    this.update();
  }

  /**
   * Adopt launched sessions the scan has now named: the terminal moves to the
   * real session id and the card becomes an ordinary expanded one.
   */
  private adoptLaunched(tiles: AgentTile[]): void {
    const adopted: string[] = [];
    for (const launch of this.launched) {
      const sessionId = matchLaunchedSession(launch.projectPath, launch.knownBefore, tiles);
      if (!sessionId || this.pinned.includes(sessionId)) continue;
      this.terminals.rekey(launch.key, sessionId);
      this.pinned = [sessionId, ...this.pinned];
      this.pinnedEvents.set(sessionId, []);
      adopted.push(launch.key);
    }
    if (adopted.length) this.launched = this.launched.filter((l) => !adopted.includes(l.key));
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
    this.adoptLaunched(tiles);
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
    const currentProject = this.projectSwitch.currentProjectPath();
    return (
      <div className="spexr-df-root">
        <NewSessionLauncher
          targets={launchTargets(this.tiles, currentProject, this.recentProjects)}
          defaultPath={currentProject ?? ""}
          configs={this.configs}
          layout={this.wallLayout}
          onLayoutChange={(layout) => this.setLayout(layout)}
          onBrowse={() => this.browseForProject()}
          onStart={(projectPath, harness, configDir) =>
            this.startNewSession(projectPath, harness, configDir)
          }
        />
        {/*
          One wrapper for every card that owns a terminal, in both arrangements:
          only its class changes, so React keeps the same DOM node and no
          TerminalMount unmounts — a remount would detach and re-attach every xterm.
        */}
        <div
          ref={this.setActiveHost}
          className={`spexr-df-active spexr-df-active--${this.wallLayout}`}
          style={{ ["--df-mosaic-columns" as string]: String(this.mosaicColumnCount()) }}
        >
          {this.launched.map((launch) => (
            <LaunchedSessionCard
              key={launch.key}
              projectName={launch.projectName}
              harness={launch.harness}
              terminal={this.terminals.live(launch.key)}
              onClose={() => this.closeLaunched(launch.key)}
              layout={this.wallLayout}
            />
          ))}
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
              layout={this.wallLayout}
            />
          ))}
        </div>
        {tiles.length === 0 ? (
          <div className="spexr-df-empty">
            No agent sessions found yet. Start one above, or run Claude or opencode elsewhere to see it here.
          </div>
        ) : groups.length > 1 ? (
          groups.map((g, i) => this.renderGroup(g, i, now))
        ) : (
          this.renderFlat(rest, now)
        )}
      </div>
    );
  }
}
