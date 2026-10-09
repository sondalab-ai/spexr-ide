import * as React from "react";
import { nls } from "@theia/core/lib/common/nls";
import { PanelHead } from "../views/panel-head.js";
import { formatDuration, modelFamily, shortId, toolIcon, visibleTools } from "./agent-pane-format.js";
import type { AgentPaneSnapshot, PaneTool } from "../../common/agent-pane-protocol.js";

export interface AgentPaneViewProps {
  /** The followed session's snapshot; undefined while there is none (no agent running, or no transcript yet). */
  readonly snapshot: AgentPaneSnapshot | undefined;
  /** The tool card shows every row, not only the last few. */
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  /** Bring the agent terminal forward: where permission prompts are answered. */
  readonly onReveal: () => void;
}

const noop = (): void => undefined;

/** +n in the success ink and −m in the danger ink: an edit's size. */
const DiffStat: React.FC<{ readonly added: number | undefined; readonly removed: number | undefined }> = ({ added, removed }) =>
  added === undefined && removed === undefined ? null : (
    <span className="spexr-agent-stat">
      <i>+{added ?? 0}</i> <s>{"−"}{removed ?? 0}</s>
    </span>
  );

const meta = (tool: PaneTool): string | undefined => {
  if (tool.state === "run") return nls.localize("spexr/agentPane/running", "running");
  if (tool.state === "error") return nls.localize("spexr/agentPane/failed", "failed");
  return tool.durationMs === undefined ? undefined : formatDuration(tool.durationMs);
};

const ToolRow: React.FC<{ readonly tool: PaneTool }> = ({ tool }) => (
  <li className="spexr-agent-tool" data-state={tool.state}>
    <span className={`codicon ${toolIcon(tool)} spexr-agent-tool__icon`} aria-hidden="true" />
    <span className="spexr-agent-tool__text">
      {tool.verb ?? tool.name}
      {tool.target ? <b className="spexr-agent-tool__target"> {tool.target}</b> : null}
      {tool.added !== undefined || tool.removed !== undefined ? <DiffStat added={tool.added} removed={tool.removed} /> : null}
    </span>
    <span className="spexr-agent-tool__meta">{meta(tool)}</span>
  </li>
);

/** The head's title: the session's name; the id's own short form when it has none yet. */
const titleOf = (s: AgentPaneSnapshot): string => s.title ?? nls.localize("spexr/agentPane/untitled", "New session");

const Empty: React.FC<{ readonly onReveal: () => void }> = ({ onReveal }) => (
  <section className="spexr-agent-pane spexr-agent-pane--empty" aria-label={nls.localize("spexr/agentPane/title", "Agent")}>
    <PanelHead eyebrow={nls.localize("spexr/agentPane/eyebrow", "Agent")} title={nls.localize("spexr/agentPane/emptyTitle", "No session yet")} />
    <div className="spexr-panel-body spexr-agent-pane__empty">
      <p className="spexr-agent-pane__hint">
        {nls.localize("spexr/agentPane/emptyHint", "The agent's turn shows here once it starts: what you asked, the tools it runs, the edits it makes and its plan.")}
      </p>
      <button type="button" className="sl-btn sl-btn--sm" onClick={onReveal}>
        {nls.localize("spexr/agentPane/openTerminal", "Open the agent terminal")}
      </button>
    </div>
  </section>
);

/**
 * The agent pane, read-only: Lumen's right pane as a view of the followed
 * session's snapshot. A head (the session's id, its name and its model), the
 * prompt, the agent's latest words, a card of the turn's tool calls, the
 * latest diff and the plan; a row asking the user to come to the terminal when
 * the agent waits for them. Nothing here animates in.
 */
export const AgentPaneView: React.FC<AgentPaneViewProps> = ({ snapshot, expanded, onToggleExpanded, onReveal }) => {
  if (!snapshot) return <Empty onReveal={onReveal} />;
  const turn = snapshot.turn;
  const family = modelFamily(snapshot.model);
  const prose = turn?.prose?.[turn.prose.length - 1];
  const { shown, hidden } = visibleTools(turn?.tools ?? [], expanded);
  const diff = turn?.diff;
  return (
    <section className="spexr-agent-pane" aria-label={nls.localize("spexr/agentPane/title", "Agent")}>
      <PanelHead
        eyebrow={`${nls.localize("spexr/agentPane/eyebrow", "Agent")} · ${shortId(snapshot.sessionId)}`}
        title={titleOf(snapshot)}
        aside={family ? <span className="sl-tag spexr-agent-pane__model">{family}</span> : undefined}
      />
      <div className="spexr-agent-pane__log">
        {snapshot.needsYou ? (
          <div className="spexr-agent-needs" role="status">
            <span className="codicon codicon-bell-dot spexr-agent-needs__icon" aria-hidden="true" />
            <span className="spexr-agent-needs__text">{nls.localize("spexr/agentPane/needsYou", "Waiting for you in the terminal")}</span>
            <button type="button" className="sl-btn sl-btn--sm" onClick={onReveal}>
              {nls.localize("spexr/agentPane/reveal", "Reveal")}
            </button>
          </div>
        ) : null}
        {turn?.prompt ? <p className="spexr-agent-prompt">{turn.prompt}</p> : null}
        {prose ? <p className="spexr-agent-prose">{prose}</p> : null}
        {shown.length > 0 ? (
          <div className="spexr-agent-tools">
            {hidden > 0 || expanded ? (
              <button type="button" className="spexr-agent-tools__fold" aria-expanded={expanded} onClick={onToggleExpanded}>
                {expanded
                  ? nls.localize("spexr/agentPane/fewer", "Show fewer")
                  : nls.localize("spexr/agentPane/earlier", "{0} earlier", hidden)}
              </button>
            ) : null}
            <ol className="spexr-agent-tools__list">
              {shown.map((tool) => (
                <ToolRow key={tool.id} tool={tool} />
              ))}
            </ol>
          </div>
        ) : null}
        {diff?.lines && diff.lines.length > 0 ? (
          <figure className="spexr-agent-diff">
            <figcaption className="spexr-agent-diff__caption">
              <span className="spexr-agent-diff__file">
                <span className="codicon codicon-file" aria-hidden="true" />
                {diff.file}
              </span>
              <DiffStat added={diff.added} removed={diff.removed} />
            </figcaption>
            <pre className="spexr-agent-diff__body">
              {diff.lines.map((line, i) => (
                <span key={i} className={`spexr-agent-diff__row spexr-agent-diff__row--${line.startsWith("+") ? "add" : "del"}`}>
                  {line}
                </span>
              ))}
            </pre>
          </figure>
        ) : null}
        {snapshot.plan && snapshot.plan.length > 0 ? (
          <div className="spexr-agent-plan">
            <span className="sl-eyebrow">{nls.localize("spexr/agentPane/plan", "Plan")}</span>
            {snapshot.plan.map((item, i) => (
              <label key={i} className="sl-check spexr-agent-plan__item" onClick={(e) => e.preventDefault()}>
                <input className="sl-check__input" type="checkbox" checked={item.done} readOnly aria-readonly="true" tabIndex={-1} onChange={noop} />
                <span className="sl-check__box" />
                <span className="sl-check__label">{item.text}</span>
              </label>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
};
