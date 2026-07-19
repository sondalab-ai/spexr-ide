import * as React from "@theia/core/shared/react";
import { Widget, UnsafeWidgetUtilities } from "@theia/core/lib/browser/widgets/widget";
import { MessageLoop } from "@theia/core/shared/@lumino/messaging";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import type { AgentSummary, AgentTile, FollowEvent } from "../../common/darkfactory-protocol.js";
import { stateLabel, relativeTime } from "./darkfactory-format.js";

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

/** The single most important status word for a tile, with its visual class. */
function statusOf(tile: AgentTile): { label: string; kind: string } {
  if (tile.lastFailed) return { label: "Failed", kind: "error" };
  if (tile.needsYou) return { label: tile.needsYouCertain ? "Needs you" : "Waiting", kind: "attn" };
  return { label: stateLabel(tile.state), kind: tile.state };
}

/** Full agent card: goal (anchor, expandable), then AI now/overview lines, then branch. */
export function AgentTileCard(props: {
  tile: AgentTile;
  now: number;
  summary?: { summary: AgentSummary; loading: boolean } | undefined;
  onOpen: (t: AgentTile) => void;
}): React.ReactElement {
  const { tile, now, summary, onOpen } = props;
  const [expanded, setExpanded] = React.useState(false);
  const status = statusOf(tile);
  const primary = capitalize(tile.goal || tile.actionLine);
  const expandable = primary.length > 90;

  return (
    <button
      className="spexr-df-card"
      data-state={tile.state}
      data-status={status.kind}
      style={{ ["--tile-accent" as string]: `var(--spexr-df-accent-${tile.accentId})` }}
      onClick={() => onOpen(tile)}
      title={tile.projectPath}
    >
      <span className="spexr-df-card__head">
        <span className="spexr-df-card__led" />
        <span className="spexr-df-card__project">{tile.projectName}</span>
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
      {summary && !summary.loading && summary.summary.now && (
        <span className="spexr-df-card__ai" title={summary.summary.now}>
          <i className="codicon codicon-sparkle" />
          <span className="spexr-df-card__ai-text">{summary.summary.now}</span>
        </span>
      )}
      {summary && !summary.loading && summary.summary.overview && (
        <span className="spexr-df-card__overview" title={summary.summary.overview}>
          {summary.summary.overview}
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
}): React.ReactElement {
  const { tile, now, summary, events, terminal, onClose, onFork } = props;
  const status = statusOf(tile);
  return (
    <section
      className="spexr-df-pinned"
      data-state={tile.state}
      data-status={status.kind}
      style={{ ["--tile-accent" as string]: `var(--spexr-df-accent-${tile.accentId})` }}
    >
      <header className="spexr-df-pinned__head">
        <span className="spexr-df-card__led" />
        <span className="spexr-df-pinned__project">{tile.projectName}</span>
        <span className="spexr-df-card__status" data-kind={status.kind}>
          {status.label}
        </span>
        <time className="spexr-df-card__time">{relativeTime(tile.lastActivityMs, now)}</time>
        <button className="spexr-df-pinned__close" title="Close" onClick={onClose}>
          <i className="codicon codicon-close" />
        </button>
      </header>
      {summary && !summary.loading && summary.summary.now && (
        <span className="spexr-df-card__ai">
          <i className="codicon codicon-sparkle" />
          <span className="spexr-df-card__ai-text">{summary.summary.now}</span>
        </span>
      )}
      {terminal ? (
        <TerminalMount term={terminal} />
      ) : (
        <div className="spexr-df-pinned__scroll">
          <FollowTranscript events={events} />
        </div>
      )}
      <footer className="spexr-df-pinned__foot">
        {terminal ? (
          <span className="spexr-df-pinned__tag">
            <i className="codicon codicon-terminal" /> interactive — resumed in this card
          </span>
        ) : (
          <>
            <span className="spexr-df-pinned__tag">
              <i className="codicon codicon-eye" /> read-only live view
            </span>
            <button className="spexr-button spexr-button--primary" onClick={() => onFork(tile)}>
              Fork &amp; continue
            </button>
          </>
        )}
      </footer>
    </section>
  );
}

/** Condensed one-line row for lower-priority sessions below the card grid. */
export function AgentCondensedRow(props: {
  tile: AgentTile;
  now: number;
  onOpen: (t: AgentTile) => void;
}): React.ReactElement {
  const { tile, now, onOpen } = props;
  const status = statusOf(tile);
  return (
    <button
      className="spexr-df-row"
      data-state={tile.state}
      data-status={status.kind}
      style={{ ["--tile-accent" as string]: `var(--spexr-df-accent-${tile.accentId})` }}
      onClick={() => onOpen(tile)}
      title={`${tile.projectPath} · ${status.label}`}
    >
      <span className="spexr-df-row__led" />
      <span className="spexr-df-row__project">{tile.projectName}</span>
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
