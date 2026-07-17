import * as React from "@theia/core/shared/react";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { stateLabel, relativeTime } from "./darkfactory-format.js";

/** The single most important status word for a tile, with its visual class. */
function statusOf(tile: AgentTile): { label: string; kind: string } {
  if (tile.lastFailed) return { label: "Failed", kind: "error" };
  if (tile.needsYou) return { label: tile.needsYouCertain ? "Needs you" : "Waiting", kind: "attn" };
  return { label: stateLabel(tile.state), kind: tile.state };
}

/** Full agent card: state, goal (anchor, expandable), AI description, recent-actions trail. */
export function AgentTileCard(props: {
  tile: AgentTile;
  now: number;
  summary?: { text: string; loading: boolean } | undefined;
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
      {summary && !summary.loading && summary.text && (
        <span className="spexr-df-card__ai" title="Local-model summary of the session">
          <i className="codicon codicon-sparkle" />
          {summary.text}
        </span>
      )}

      {tile.recentActions.length > 0 && (
        <span className="spexr-df-card__trail" title={tile.recentActions.join("  →  ")}>
          {tile.recentActions.map((a, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="spexr-df-card__sep">›</span>}
              <span className="spexr-df-card__step">{a}</span>
            </React.Fragment>
          ))}
        </span>
      )}

      {tile.gitBranch && (
        <span className="spexr-df-card__meta">
          <span className="spexr-df-card__branch" title={`Branch: ${tile.gitBranch}`}>
            <i className="codicon codicon-git-branch" />
            {tile.gitBranch}
          </span>
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
