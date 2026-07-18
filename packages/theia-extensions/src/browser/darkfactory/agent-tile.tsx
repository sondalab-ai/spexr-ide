import * as React from "@theia/core/shared/react";
import type { AgentSummary, AgentTile } from "../../common/darkfactory-protocol.js";
import { stateLabel, relativeTime } from "./darkfactory-format.js";

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
        <span className={`spexr-df-card__goal${expanded ? " is-expanded" : ""}`}>{primary}</span>
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
  scrollback: string;
  onClose: () => void;
  onOpenTerminal: (t: AgentTile) => void;
}): React.ReactElement {
  const { tile, now, summary, scrollback, onClose, onOpenTerminal } = props;
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
      <pre className="spexr-df-pinned__scroll">{scrollback || "Waiting for activity…"}</pre>
      <footer className="spexr-df-pinned__foot">
        <span className="spexr-df-pinned__tag">
          <i className="codicon codicon-eye" /> read-only live view
        </span>
        <button className="spexr-button spexr-button--primary" onClick={() => onOpenTerminal(tile)}>
          Continue in terminal
        </button>
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
