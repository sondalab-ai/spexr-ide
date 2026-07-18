import * as React from "@theia/core/shared/react";
import type { AgentSummary, AgentTile } from "../../common/darkfactory-protocol.js";
import { stateLabel, relativeTime } from "./darkfactory-format.js";

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
  const primary = tile.goal || tile.actionLine;
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
