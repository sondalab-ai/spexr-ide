import * as React from "@theia/core/shared/react";
import { Widget, UnsafeWidgetUtilities } from "@theia/core/lib/browser/widgets/widget";
import { MessageLoop } from "@theia/core/shared/@lumino/messaging";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import type { AgentSummary, AgentTile, FollowEvent } from "../../common/darkfactory-protocol.js";
import { stateLabel, relativeTime } from "./darkfactory-format.js";
import type { TileGroup } from "./darkfactory-format.js";

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
}): React.ReactElement {
  const { tile, now, summary, events, terminal, onClose, onFork, onOpenProject, isCurrent } = props;
  const status = statusOf(tile);
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
  return (
    <section
      className="spexr-df-pinned"
      data-state={tile.state}
      data-status={status.kind}
      style={{ ["--tile-accent" as string]: `var(--sl-df-accent-${tile.accentId})` }}
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
      {summary && !summary.loading && summaryLines(summary.summary).headline && (
        <span className="spexr-df-card__ai">
          <i className="codicon codicon-sparkle" />
          <span className="spexr-df-card__ai-text">{summaryLines(summary.summary).headline}</span>
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
