import * as React from "@theia/core/shared/react";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { permissionLabel, stateLabel, relativeTime } from "./darkfactory-format.js";

/** The single most important status word for a tile, with its visual class. */
function statusOf(tile: AgentTile): { label: string; kind: string } {
  if (tile.lastFailed) return { label: "Failed", kind: "error" };
  if (tile.needsYou) return { label: tile.needsYouCertain ? "Needs you" : "Waiting", kind: "attn" };
  return { label: stateLabel(tile.state), kind: tile.state };
}

/** Compact, self-explanatory permission phrase. */
function permShort(mode: string | undefined): string {
  return mode === "auto" ? "auto-approve" : mode === "plan" ? "plan mode" : "asks each time";
}

/** Full agent card: state, goal (anchor, expandable), recent-actions trail, textual meta. */
export function AgentTileCard(props: {
  tile: AgentTile;
  now: number;
  onOpen: (t: AgentTile) => void;
}): React.ReactElement {
  const { tile, now, onOpen } = props;
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

      <span className="spexr-df-card__meta">
        {tile.gitBranch && (
          <span className="spexr-df-card__branch" title={`Branch: ${tile.gitBranch}`}>
            <i className="codicon codicon-git-branch" />
            {tile.gitBranch}
          </span>
        )}
        <span className="spexr-df-card__perm" title={permissionLabel(tile.permissionMode)}>
          {permShort(tile.permissionMode)}
        </span>
        <span className="spexr-df-card__turns" title={`${tile.turnCount} turns in this session`}>
          {tile.turnCount} turns
        </span>
      </span>
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
