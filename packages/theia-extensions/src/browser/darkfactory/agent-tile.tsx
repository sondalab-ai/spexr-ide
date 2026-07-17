import * as React from "@theia/core/shared/react";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { permissionLabel, modeLabel, stateLabel, relativeTime } from "./darkfactory-format.js";

const PERMISSION_ICON: Record<string, string> = {
  auto: "codicon-check-all",
  plan: "codicon-map",
  default: "codicon-question",
};

/** One glanceable agent tile. Clicking selects it for the focus pane. */
export function AgentTileCard(props: {
  tile: AgentTile;
  now: number;
  onOpen: (t: AgentTile) => void;
}): React.ReactElement {
  const { tile, now, onOpen } = props;
  return (
    <button
      className="spexr-df-tile"
      data-state={tile.state}
      data-needs-you={tile.needsYou ? "1" : "0"}
      data-needs-you-certain={tile.needsYouCertain ? "1" : "0"}
      style={{ ["--tile-accent" as string]: `var(--spexr-df-accent-${tile.accentId})` }}
      onClick={() => onOpen(tile)}
      title={`${tile.projectName} · ${stateLabel(tile.state)}`}
    >
      <span className="spexr-df-tile__head">
        <span className="spexr-df-tile__led" />
        <span className="spexr-df-tile__project">{tile.projectName}</span>
        {tile.gitBranch && <span className="spexr-df-tile__branch">{tile.gitBranch}</span>}
      </span>
      <span className="spexr-df-tile__action">
        {tile.tool && <span className="spexr-df-tile__chip">{tile.tool}</span>}
        <span className="spexr-df-tile__actionline">{tile.actionLine}</span>
      </span>
      <span className="spexr-df-tile__meta">
        {tile.needsYou && (
          <span className="spexr-df-tile__needs">{tile.needsYouCertain ? "Needs you" : "Maybe waiting"}</span>
        )}
        <span className="spexr-df-tile__perm" title={permissionLabel(tile.permissionMode)}>
          <i className={`codicon ${PERMISSION_ICON[tile.permissionMode ?? "default"] ?? "codicon-question"}`} />
        </span>
        {modeLabel(tile.mode) && <em>{modeLabel(tile.mode)}</em>}
        <time>{relativeTime(tile.lastActivityMs, now)}</time>
      </span>
    </button>
  );
}
