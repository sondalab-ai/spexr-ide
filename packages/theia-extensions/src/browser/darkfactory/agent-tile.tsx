import * as React from "@theia/core/shared/react";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { permissionLabel, modeLabel, stateLabel, relativeTime } from "./darkfactory-format.js";

const PERMISSION_ICON: Record<string, string> = {
  auto: "codicon-check-all",
  plan: "codicon-map",
  default: "codicon-question",
};

function StatusPill(props: { tile: AgentTile }): React.ReactElement | null {
  const { tile } = props;
  if (tile.lastFailed) return <span className="spexr-df-pill spexr-df-pill--error">Failed</span>;
  if (tile.needsYou) {
    return (
      <span className="spexr-df-pill spexr-df-pill--attn">
        {tile.needsYouCertain ? "Needs you" : "Maybe waiting"}
      </span>
    );
  }
  return null;
}

/** Full agent card: goal, recent-actions trail, current action, status. */
export function AgentTileCard(props: {
  tile: AgentTile;
  now: number;
  onOpen: (t: AgentTile) => void;
}): React.ReactElement {
  const { tile, now, onOpen } = props;
  return (
    <button
      className="spexr-df-card"
      data-state={tile.state}
      data-needs-you={tile.needsYou ? "1" : "0"}
      data-needs-you-certain={tile.needsYouCertain ? "1" : "0"}
      data-failed={tile.lastFailed ? "1" : "0"}
      style={{ ["--tile-accent" as string]: `var(--spexr-df-accent-${tile.accentId})` }}
      onClick={() => onOpen(tile)}
      title={`${tile.projectPath}`}
    >
      <span className="spexr-df-card__head">
        <span className="spexr-df-card__led" />
        <span className="spexr-df-card__project">{tile.projectName}</span>
        <time className="spexr-df-card__time">{relativeTime(tile.lastActivityMs, now)}</time>
      </span>

      {tile.goal && <span className="spexr-df-card__goal">{tile.goal}</span>}

      {tile.recentActions.length > 0 && (
        <span className="spexr-df-card__trail">
          {tile.recentActions.map((a, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="spexr-df-card__sep">›</span>}
              <span className="spexr-df-card__step">{a}</span>
            </React.Fragment>
          ))}
        </span>
      )}

      <span className="spexr-df-card__foot">
        {tile.tool && <span className="spexr-df-card__chip">{tile.tool}</span>}
        <span className="spexr-df-card__now">{tile.actionLine}</span>
        <StatusPill tile={tile} />
        <span className="spexr-df-card__meta">
          {tile.gitBranch && (
            <span className="spexr-df-card__branch" title={tile.gitBranch}>
              {tile.gitBranch}
            </span>
          )}
          <span className="spexr-df-card__perm" title={permissionLabel(tile.permissionMode)}>
            <i className={`codicon ${PERMISSION_ICON[tile.permissionMode ?? "default"] ?? "codicon-question"}`} />
          </span>
          {modeLabel(tile.mode) && <em>{modeLabel(tile.mode)}</em>}
          <span className="spexr-df-card__turns">{tile.turnCount}⟳</span>
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
  return (
    <button
      className="spexr-df-row"
      data-state={tile.state}
      data-needs-you={tile.needsYou ? "1" : "0"}
      data-failed={tile.lastFailed ? "1" : "0"}
      style={{ ["--tile-accent" as string]: `var(--spexr-df-accent-${tile.accentId})` }}
      onClick={() => onOpen(tile)}
      title={`${tile.projectPath} · ${stateLabel(tile.state)}`}
    >
      <span className="spexr-df-row__led" />
      <span className="spexr-df-row__project">{tile.projectName}</span>
      <span className="spexr-df-row__action">{tile.actionLine}</span>
      {tile.lastFailed && <span className="spexr-df-pill spexr-df-pill--error">Failed</span>}
      {tile.needsYou && !tile.lastFailed && <span className="spexr-df-pill spexr-df-pill--attn">Waiting</span>}
      <time className="spexr-df-row__time">{relativeTime(tile.lastActivityMs, now)}</time>
    </button>
  );
}
