import * as React from "@theia/core/shared/react";
import { Widget, UnsafeWidgetUtilities } from "@theia/core/lib/browser/widgets/widget";
import { MessageLoop } from "@theia/core/shared/@lumino/messaging";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import type {
  AgentSummary,
  AgentTile,
  ClaudeConfigDir,
  FollowEvent,
} from "../../common/darkfactory-protocol.js";
import type { HarnessId } from "../../common/harness/harness-types.js";
import { stateLabel, relativeTime, projectDisplayName } from "./darkfactory-format.js";
import type { TileGroup, LaunchTarget, LaunchTargetKind } from "./darkfactory-format.js";
import { clampPinnedHeight, readPinnedHeight, writePinnedHeight } from "./pinned-card-height.js";
import { readConfigDirChoice, writeConfigDirChoice } from "./new-session-config.js";
import type { WallLayout } from "./wall-layout.js";

/**
 * Mount a Theia TerminalWidget into a React-owned host div: attach its Lumino node
 * imperatively (UnsafeWidgetUtilities allows a non-body host), keep it fitted with
 * a ResizeObserver, and detach on unmount. React never reconciles the host's
 * children, so the terminal survives the widget's re-renders. Disposal of the
 * terminal itself stays with the manager that created it.
 */
function TerminalMount(props: { term: TerminalWidget }): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const host = hostRef.current;
    const term = props.term;
    if (!host) return undefined;
    UnsafeWidgetUtilities.attach(term, host);
    const fit = (): void => {
      try {
        MessageLoop.sendMessage(term, Widget.ResizeMessage.UnknownSize);
      } catch {
        /* terminal not ready yet */
      }
    };
    fit();
    term.activate();
    const ro = new ResizeObserver(() => fit());
    ro.observe(host);
    return () => {
      ro.disconnect();
      try {
        Widget.detach(term);
      } catch {
        /* already detached or disposed */
      }
    };
  }, [props.term]);
  return <div className="spexr-df-termhost" ref={hostRef} />;
}

/** Distance (px) from the bottom still counted as following the live tail. */
const TAIL_SLACK = 24;

/** Terminal-like prefix glyph per follow-event kind. */
const FOLLOW_PREFIX: Record<FollowEvent["kind"], string> = {
  prompt: "❯",
  assistant: "●",
  tool: "$",
  result: "",
  error: "✗",
};

/** Render the read-only follow as distinct, terminal-styled lines (prompts, replies, commands, output). */
export function FollowTranscript(props: { events: FollowEvent[] }): React.ReactElement {
  const { events } = props;
  if (events.length === 0) {
    return <div className="spexr-df-term spexr-df-term--empty">Waiting for activity…</div>;
  }
  return (
    <div className="spexr-df-term">
      {events.map((e, i) => (
        <div key={i} className="spexr-df-term__line" data-kind={e.kind}>
          {FOLLOW_PREFIX[e.kind] && <span className="spexr-df-term__glyph">{FOLLOW_PREFIX[e.kind]}</span>}
          <span className="spexr-df-term__text">{e.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Capitalize the first letter (prompts often start lowercase). */
function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Order the two AI clauses by visual weight: the session goal (overview) is the
 * headline, the moment-to-moment activity (now) the muted sub-line. Falls back to
 * `now` as the headline when there is no overview, and never repeats a line.
 */
function summaryLines(s: AgentSummary): { headline: string; sub: string } {
  const headline = s.overview || s.now;
  const sub = s.overview ? s.now : "";
  return { headline, sub };
}

/** The single most important status word for a tile, with its visual class. */
function statusOf(tile: AgentTile): { label: string; kind: string } {
  if (tile.lastFailed) return { label: "Failed", kind: "error" };
  if (tile.needsYou) return { label: tile.needsYouCertain ? "Needs you" : "Waiting", kind: "attn" };
  return { label: stateLabel(tile.state), kind: tile.state };
}

/** Marks the tile whose project this window has loaded. */
function CurrentProjectChip(): React.ReactElement {
  return (
    <span className="spexr-df-card__current" title="This is the project loaded in this window">
      current
    </span>
  );
}

/**
 * Load the tile's project in this window. Rendered as a `span` because the card
 * itself is a `button` and nested buttons are invalid HTML; the click is stopped
 * so it does not also pin the session.
 */
function OpenProjectAction(props: {
  tile: AgentTile;
  onOpenProject: (t: AgentTile) => void;
}): React.ReactElement {
  const { tile, onOpenProject } = props;
  return (
    <span
      className="spexr-df-card__open"
      role="button"
      title={`Open ${tile.projectPath} — reloads the window`}
      onClick={(e) => {
        e.stopPropagation();
        onOpenProject(tile);
      }}
    >
      <i className="codicon codicon-folder-opened" />
    </span>
  );
}

/**
 * Header for one project's sessions. Carries the identity the member tiles no
 * longer need to repeat, plus the group's aggregate state, and toggles the group
 * open or shut.
 */
export function AgentGroupHeader(props: {
  group: TileGroup;
  collapsed: boolean;
  onToggle: (projectPath: string) => void;
  onOpenProject: (t: AgentTile) => void;
}): React.ReactElement {
  const { group, collapsed, onToggle, onOpenProject } = props;
  const head = group.tiles[0]!;
  // Same precedence as a tile's own status: a failure outranks a wait, and the two
  // keep the wall's colours apart — accent for waiting, danger for failed.
  const failed = group.tiles.filter((t) => t.lastFailed).length;
  const waiting = group.tiles.filter((t) => !t.lastFailed && t.needsYou).length;
  const state = group.tiles.some((t) => t.state === "working") ? "working" : head.state;
  return (
    <header
      className="spexr-df-group__bar"
      data-state={state}
      style={{ ["--tile-accent" as string]: `var(--sl-df-accent-${group.accentId})` }}
    >
      <button
        className="spexr-df-group__toggle"
        aria-expanded={!collapsed}
        title={collapsed ? "Expand this project" : "Collapse this project"}
        onClick={() => onToggle(group.projectPath)}
      >
        <i className={`codicon codicon-chevron-${collapsed ? "right" : "down"}`} />
      </button>
      <span className="spexr-df-card__led" />
      <span className="spexr-df-group__name" title={group.projectPath}>
        {group.label}
      </span>
      {group.isCurrent ? <CurrentProjectChip /> : <OpenProjectAction tile={head} onOpenProject={onOpenProject} />}
      <span className="spexr-df-group__count">
        {group.tiles.length} {group.tiles.length === 1 ? "session" : "sessions"}
      </span>
      {waiting > 0 && (
        <span className="spexr-df-group__attn" data-kind="attn">
          {waiting} need you
        </span>
      )}
      {failed > 0 && (
        <span className="spexr-df-group__attn" data-kind="error">
          {failed} failed
        </span>
      )}
    </header>
  );
}

/** Full agent card: goal (anchor, expandable), then AI now/overview lines, then branch. */
export function AgentTileCard(props: {
  tile: AgentTile;
  now: number;
  summary?: { summary: AgentSummary; loading: boolean } | undefined;
  onOpen: (t: AgentTile) => void;
  onOpenProject: (t: AgentTile) => void;
  /** True when this tile's project is the one loaded in the window. */
  isCurrent: boolean;
  /** False inside a project group, whose header already names the project. */
  showProject: boolean;
}): React.ReactElement {
  const { tile, now, summary, onOpen, onOpenProject, isCurrent, showProject } = props;
  const [expanded, setExpanded] = React.useState(false);
  const status = statusOf(tile);
  const primary = capitalize(tile.goal || tile.actionLine);
  const expandable = primary.length > 90;
  const ai = summary && !summary.loading ? summaryLines(summary.summary) : undefined;

  return (
    <button
      className="spexr-df-card"
      data-state={tile.state}
      data-status={status.kind}
      style={{ ["--tile-accent" as string]: `var(--sl-df-accent-${tile.accentId})` }}
      onClick={() => onOpen(tile)}
      title={tile.projectPath}
    >
      <span className="spexr-df-card__head">
        <span className="spexr-df-card__led" />
        {showProject && (
          <>
            <span className="spexr-df-card__project">{tile.projectName}</span>
            {isCurrent ? <CurrentProjectChip /> : <OpenProjectAction tile={tile} onOpenProject={onOpenProject} />}
          </>
        )}
        <span className="spexr-df-card__harness">{tile.harness}</span>
        <span className="spexr-df-card__status" data-kind={status.kind}>
          {status.label}
        </span>
        <time className="spexr-df-card__time">{relativeTime(tile.lastActivityMs, now)}</time>
      </span>

      {primary && (
        <span className={`spexr-df-card__goal${expandable && !expanded ? " is-clamped" : ""}`}>
          {primary}
        </span>
      )}
      {expandable && (
        <span
          className="spexr-df-card__more"
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? "Show less" : "Show full prompt"}
        </span>
      )}

      {summary?.loading && (
        <span className="spexr-df-card__ai is-loading" title="Local model summarizing the session…">
          <i className="codicon codicon-sparkle" />
          Summarizing…
        </span>
      )}
      {ai?.headline && (
        <span className="spexr-df-card__ai" title={ai.headline}>
          <i className="codicon codicon-sparkle" />
          <span className="spexr-df-card__ai-text">{ai.headline}</span>
        </span>
      )}
      {ai?.sub && (
        <span className="spexr-df-card__overview" title={ai.sub}>
          {ai.sub}
        </span>
      )}

      {tile.gitBranch && (
        <span className="spexr-df-card__branch" title={tile.gitBranch}>
          <i className="codicon codicon-git-branch" />
          <span className="spexr-df-card__branch-name">{tile.gitBranch}</span>
        </span>
      )}
    </button>
  );
}

/**
 * Expanded, pinned card lifted above the grid: a large read-only live view of one
 * session's transcript, with an action to continue it in an interactive terminal.
 */
/**
 * Drag-to-resize height for an expanded card, remembered across sessions. The
 * height is returned rather than applied, because a user-set one has to
 * override `min-height` and `max-height` too: the CSS bounds would otherwise
 * keep fighting the value being dragged.
 */
function usePinnedHeight(layout: WallLayout): {
  ref: React.MutableRefObject<HTMLElement | null>;
  height: number | undefined;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
} {
  const ref = React.useRef<HTMLElement | null>(null);
  const [height, setHeight] = React.useState<number | undefined>(() =>
    readPinnedHeight(window.localStorage, window.innerHeight, layout),
  );
  // Each arrangement keeps its own height, so switching adopts the other one's
  // — a stack height carried into the mosaic would make every cell a full row tall.
  React.useEffect(() => {
    setHeight(readPinnedHeight(window.localStorage, window.innerHeight, layout));
  }, [layout]);
  const onResizeStart = (event: React.PointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (!el) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const startY = event.clientY;
    const startHeight = el.getBoundingClientRect().height;
    let latest = startHeight;
    const onMove = (e: PointerEvent): void => {
      latest = clampPinnedHeight(startHeight + e.clientY - startY, window.innerHeight);
      setHeight(latest);
    };
    const onEnd = (e: PointerEvent): void => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      writePinnedHeight(window.localStorage, latest, layout);
    };
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  };
  return { ref, height, onResizeStart };
}

/** The strip along a card's bottom edge that {@link usePinnedHeight} listens on. */
function CardResizeHandle(props: {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}): React.ReactElement {
  return (
    <div
      className="spexr-df-pinned__resize"
      onPointerDown={props.onPointerDown}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize card"
      title="Drag to resize"
    />
  );
}

/** A user-set card height, as the style that overrides the CSS bounds. */
function heightStyle(height: number | undefined): React.CSSProperties {
  return height !== undefined ? { height, minHeight: height, maxHeight: height } : {};
}

export function AgentPinnedCard(props: {
  tile: AgentTile;
  now: number;
  summary?: { summary: AgentSummary; loading: boolean } | undefined;
  events: FollowEvent[];
  /** When present, the card hosts this interactive terminal instead of the read-only view. */
  terminal?: TerminalWidget | undefined;
  onClose: () => void;
  onFork: (t: AgentTile) => void;
  onOpenProject: (t: AgentTile) => void;
  /** True when this tile's project is the one loaded in the window. */
  isCurrent: boolean;
  /** How the wall arranges active cards; the card's height is remembered per arrangement. */
  layout: WallLayout;
}): React.ReactElement {
  const { tile, now, summary, events, terminal, onClose, onFork, onOpenProject, isCurrent, layout } = props;
  const status = statusOf(tile);
  // Both clauses, like a grid tile: the overview alone is the session goal, which
  // barely moves between inferences, so a card showing only it reads as frozen
  // while the work below it changes. `now` is the clause that tracks the session.
  const ai = summary && !summary.loading ? summaryLines(summary.summary) : undefined;
  // The card is height-bounded so its CTAs stay in view, which makes the
  // transcript the scrolling region — keep it on the newest line, unless the
  // user has scrolled up to read back.
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const followTail = React.useRef(true);
  React.useEffect(() => {
    const el = scroller.current;
    if (el && followTail.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  const onScroll = (): void => {
    const el = scroller.current;
    if (el) followTail.current = el.scrollHeight - el.scrollTop - el.clientHeight <= TAIL_SLACK;
  };
  const { ref: card, height, onResizeStart } = usePinnedHeight(layout);
  return (
    <section
      ref={card}
      className="spexr-df-pinned"
      data-state={tile.state}
      data-status={status.kind}
      style={{
        ["--tile-accent" as string]: `var(--sl-df-accent-${tile.accentId})`,
        ...heightStyle(height),
      }}
    >
      <header className="spexr-df-pinned__bar">
        <div className="spexr-df-pinned__head">
          <span className="spexr-df-card__led" />
          <span className="spexr-df-pinned__project">{tile.projectName}</span>
          {isCurrent && <CurrentProjectChip />}
          <span className="spexr-df-card__harness">{tile.harness}</span>
          <span className="spexr-df-card__status" data-kind={status.kind}>
            {status.label}
          </span>
          <time className="spexr-df-card__time">{relativeTime(tile.lastActivityMs, now)}</time>
          <button className="spexr-df-pinned__close" title="Close" onClick={onClose}>
            <i className="codicon codicon-close" />
          </button>
        </div>
        <div className="spexr-df-pinned__actions">
          <span className="spexr-df-pinned__tag">
            {terminal ? (
              <>
                <i className="codicon codicon-terminal" /> interactive — resumed in this card
              </>
            ) : tile.harness === "opencode" ? (
              <>
                <i className="codicon codicon-run" /> live elsewhere
              </>
            ) : (
              <>
                <i className="codicon codicon-eye" /> read-only live view
              </>
            )}
          </span>
          {!isCurrent && (
            <button className="spexr-button" onClick={() => onOpenProject(tile)} title={tile.projectPath}>
              Open project
            </button>
          )}
          {!terminal && (
            <button className="spexr-button spexr-button--primary" onClick={() => onFork(tile)}>
              Fork &amp; continue
            </button>
          )}
        </div>
      </header>
      {ai?.headline && (
        <span className="spexr-df-card__ai" title={ai.headline}>
          <i className="codicon codicon-sparkle" />
          <span className="spexr-df-card__ai-text">{ai.headline}</span>
        </span>
      )}
      {ai?.sub && (
        <span className="spexr-df-card__overview" title={ai.sub}>
          {ai.sub}
        </span>
      )}
      {terminal ? (
        <TerminalMount term={terminal} />
      ) : tile.harness === "opencode" ? (
        <div className="spexr-df-pinned__nofollow">
          This session is live elsewhere — a read-only transcript view for opencode isn&apos;t available yet.
          Fork it to continue the work in this card.
        </div>
      ) : (
        <div className="spexr-df-pinned__scroll" ref={scroller} onScroll={onScroll}>
          <FollowTranscript events={events} />
        </div>
      )}
      <CardResizeHandle onPointerDown={onResizeStart} />
    </section>
  );
}

/** How each arrangement is named and explained in the launcher's toggle. */
const LAYOUTS: readonly { id: WallLayout; label: string; title: string }[] = [
  { id: "stack", label: "Stack", title: "One full-width card per running terminal" },
  { id: "mosaic", label: "Mosaic", title: "Running terminals side by side, as a grid" },
];

/** Segmented control that switches how the active terminal cards are arranged. */
function WallLayoutToggle(props: {
  layout: WallLayout;
  onChange: (layout: WallLayout) => void;
}): React.ReactElement {
  const { layout, onChange } = props;
  return (
    <div className="spexr-df-layout" role="group" aria-label="Arrangement of running terminals">
      {LAYOUTS.map((l) => (
        <button
          key={l.id}
          className="spexr-df-layout__option"
          data-active={l.id === layout}
          aria-pressed={l.id === layout}
          title={l.title}
          onClick={() => onChange(l.id)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** Heading each group of projects gets in the launcher's Project dropdown. */
const TARGET_GROUPS: readonly { kind: LaunchTargetKind; label: string }[] = [
  { kind: "current", label: "This window" },
  { kind: "session", label: "With sessions" },
  { kind: "recent", label: "Recent" },
  { kind: "picked", label: "Browsed" },
];

/**
 * The card at the head of the stack that starts a session instead of showing
 * one. The project list is the wall's own projects plus the recent workspaces,
 * so starting work on another checkout costs no window switch, and Browse
 * reaches a project this window has never opened at all. The harness is picked
 * here because both are first-class on the wall.
 */
export function NewSessionLauncher(props: {
  targets: readonly LaunchTarget[];
  /** Pre-selected project — the window's own, when it has one. */
  defaultPath: string;
  /** Claude accounts to choose between; a single one needs no control. */
  configs: readonly ClaudeConfigDir[];
  /** Current arrangement of the active cards, and the way to change it. */
  layout: WallLayout;
  onLayoutChange: (layout: WallLayout) => void;
  /** Ask for a folder; resolves to its normalized path, or undefined if cancelled. */
  onBrowse: () => Promise<string | undefined>;
  onStart: (projectPath: string, harness: HarnessId, configDir: string) => void;
}): React.ReactElement {
  const { targets, defaultPath, configs, layout, onLayoutChange, onBrowse, onStart } = props;
  const first = targets[0]?.path ?? "";
  const [path, setPath] = React.useState(defaultPath || first);
  const [harness, setHarness] = React.useState<HarnessId>("claude");
  const [configDir, setConfigDir] = React.useState("");
  // Folders browsed to during this session. They are kept here rather than
  // pushed back to the wall because a browsed folder is a choice, not a
  // discovery: it must stay in the dropdown so the controlled select keeps an
  // option matching `path`, but it has no business outliving the widget.
  const [picked, setPicked] = React.useState<readonly LaunchTarget[]>([]);
  // The wall's projects arrive asynchronously: adopt a real one as soon as there is one.
  React.useEffect(() => {
    if (!path && (defaultPath || first)) setPath(defaultPath || first);
  }, [defaultPath, first, path]);
  // Accounts arrive asynchronously too; re-pick whenever the current choice is
  // not among them, which also covers the first render (nothing chosen yet).
  React.useEffect(() => {
    setConfigDir((cur) =>
      cur && configs.some((c) => c.path === cur)
        ? cur
        : readConfigDirChoice(window.localStorage, configs),
    );
  }, [configs]);
  // Opencode has no config-dir override, so the account is Claude's alone.
  const pickableConfigs = harness === "claude" && configs.length > 1;
  // With nothing to pick between, the account is left unset on purpose: the
  // terminal manager then falls back to the SPEXR preference, which is what a
  // single-account machine has always done.
  const start = (): void => {
    if (!path) return;
    const dir = pickableConfigs ? configDir : "";
    if (dir) writeConfigDirChoice(window.localStorage, dir);
    onStart(path, harness, dir);
  };
  const browse = (): void => {
    void onBrowse().then((chosen) => {
      if (!chosen) return; // cancelled: leave the current choice alone
      setPicked((cur) =>
        cur.some((t) => t.path === chosen)
          ? cur
          : [...cur, { path: chosen, name: projectDisplayName(chosen), kind: "picked" }],
      );
      setPath(chosen);
    });
  };
  // A browsed folder the wall has meanwhile discovered is dropped: it is the
  // same project, and two options with one value confuse a controlled select.
  const all = [...targets, ...picked.filter((t) => !targets.some((o) => o.path === t.path))];
  return (
    <section className="spexr-df-launcher">
      <div className="spexr-df-launcher__head">
        <i className="codicon codicon-add" />
        <span className="spexr-df-launcher__title">Start a new session</span>
        <WallLayoutToggle layout={layout} onChange={onLayoutChange} />
      </div>
      <div className="spexr-df-launcher__controls">
        <label className="spexr-df-launcher__field">
          <span className="spexr-df-launcher__label">Project</span>
          <div className="spexr-df-launcher__project">
            <select
              className="spexr-df-launcher__select"
              value={path}
              title={path}
              onChange={(e) => setPath(e.target.value)}
            >
              {TARGET_GROUPS.map(({ kind, label }) => {
                const group = all.filter((t) => t.kind === kind);
                return group.length === 0 ? null : (
                  <optgroup key={kind} label={label}>
                    {group.map((t) => (
                      <option key={t.path} value={t.path} title={t.path}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <button
              className="spexr-df-launcher__browse"
              title="Start in a folder that is not listed"
              onClick={browse}
            >
              <i className="codicon codicon-folder-opened" />
            </button>
          </div>
        </label>
        <label className="spexr-df-launcher__field">
          <span className="spexr-df-launcher__label">Harness</span>
          <select
            className="spexr-df-launcher__select"
            value={harness}
            onChange={(e) => setHarness(e.target.value as HarnessId)}
          >
            <option value="claude">claude</option>
            <option value="opencode">opencode</option>
          </select>
        </label>
        {pickableConfigs && (
          <label className="spexr-df-launcher__field">
            <span className="spexr-df-launcher__label">Config</span>
            <select
              className="spexr-df-launcher__select"
              value={configDir}
              title={configDir}
              onChange={(e) => setConfigDir(e.target.value)}
            >
              {configs.map((c) => (
                <option key={c.path} value={c.path}>
                  {c.isDefault ? `${c.label} (default)` : c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="spexr-button spexr-button--primary spexr-df-launcher__start"
          disabled={!path}
          onClick={start}
        >
          <i className="codicon codicon-play" /> Start
        </button>
      </div>
      {all.length === 0 && (
        <p className="spexr-df-launcher__empty">
          No project to start in yet — browse to a folder, open a workspace, or wait for the
          scan to find one.
        </p>
      )}
    </section>
  );
}

/**
 * A session this window has just started. It is deliberately not an
 * {@link AgentPinnedCard}: there is no tile to describe it until the scan finds
 * its transcript, and inventing a status for it would be a lie. Once the scan
 * does find it, the wall swaps this card for the real one.
 */
export function LaunchedSessionCard(props: {
  projectName: string;
  harness: HarnessId;
  terminal?: TerminalWidget | undefined;
  onClose: () => void;
  /** How the wall arranges active cards; the card's height is remembered per arrangement. */
  layout: WallLayout;
}): React.ReactElement {
  const { projectName, harness, terminal, onClose, layout } = props;
  const { ref: card, height, onResizeStart } = usePinnedHeight(layout);
  return (
    <section className="spexr-df-pinned" ref={card} data-state="working" style={heightStyle(height)}>
      <header className="spexr-df-pinned__bar">
        <div className="spexr-df-pinned__head">
          <span className="spexr-df-card__led" />
          <span className="spexr-df-pinned__project">{projectName}</span>
          <span className="spexr-df-card__harness">{harness}</span>
          <span className="spexr-df-card__status" data-kind="working">
            new session
          </span>
          <button className="spexr-df-pinned__close" title="Close" onClick={onClose}>
            <i className="codicon codicon-close" />
          </button>
        </div>
      </header>
      {terminal ? (
        <TerminalMount term={terminal} />
      ) : (
        <div className="spexr-df-pinned__nofollow">Starting the session…</div>
      )}
      <CardResizeHandle onPointerDown={onResizeStart} />
    </section>
  );
}

/** Condensed one-line row for lower-priority sessions below the card grid. */
export function AgentCondensedRow(props: {
  tile: AgentTile;
  now: number;
  onOpen: (t: AgentTile) => void;
  /** True when this tile's project is the one loaded in the window. */
  isCurrent: boolean;
  /** False inside a project group, whose header already names the project. */
  showProject: boolean;
}): React.ReactElement {
  const { tile, now, onOpen, isCurrent, showProject } = props;
  const status = statusOf(tile);
  return (
    <button
      className="spexr-df-row"
      data-state={tile.state}
      data-status={status.kind}
      style={{ ["--tile-accent" as string]: `var(--sl-df-accent-${tile.accentId})` }}
      onClick={() => onOpen(tile)}
      title={`${tile.projectPath} · ${status.label}`}
    >
      <span className="spexr-df-row__led" />
      {showProject && (
        <>
          <span className="spexr-df-row__project">{tile.projectName}</span>
          {isCurrent && <CurrentProjectChip />}
        </>
      )}
      <span className="spexr-df-row__harness">{tile.harness}</span>
      <span className="spexr-df-row__action">{tile.goal || tile.actionLine}</span>
      {(tile.lastFailed || tile.needsYou) && (
        <span className="spexr-df-row__status" data-kind={status.kind}>
          {status.label}
        </span>
      )}
      <time className="spexr-df-row__time">{relativeTime(tile.lastActivityMs, now)}</time>
    </button>
  );
}
