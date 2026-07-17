import * as React from "@theia/core/shared/react";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { permissionLabel, modeLabel, stateLabel, relativeTime } from "./darkfactory-format.js";

const PERMISSION_ICON: Record<string, string> = {
  auto: "codicon-check-all",
  plan: "codicon-map",
  default: "codicon-question",
};

/** The single most important status word for a tile, with its visual class. */
function statusOf(tile: AgentTile): { label: string; kind: string } {
  if (tile.lastFailed) return { label: "Failed", kind: "error" };
  if (tile.needsYou) return { label: tile.needsYouCertain ? "Needs you" : "Waiting", kind: "attn" };
  return { label: stateLabel(tile.state), kind: tile.state };
}

/** Full agent card: state, goal (anchor), recent-actions trail, meta. */
export function AgentTileCard(props: {
  tile: AgentTile;
  now: number;
  onOpen: (t: AgentTile) => void;
}): React.ReactElement {
  const { tile, now, onOpen } = props;
  const status = statusOf(tile);
  const primary = tile.goal || tile.actionLine;
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

      {primary && <span className="spexr-df-card__goal">{primary}</span>}

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
