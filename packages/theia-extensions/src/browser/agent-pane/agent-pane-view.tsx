import * as React from "react";
import { nls } from "@theia/core/lib/common/nls";
import { PanelHead } from "../views/panel-head.js";
import { TOOL_ROWS_SHOWN, formatDuration, inlineCode, modelFamily, plainTarget, shortId, toolIcon, visibleTools } from "./agent-pane-format.js";
import type { AgentPaneSnapshot, PaneTool } from "../../common/agent-pane-protocol.js";

export interface AgentPaneViewProps {
  /** The followed session's snapshot; undefined while there is none (no agent running, or no transcript yet). */
  readonly snapshot: AgentPaneSnapshot | undefined;
  /** The tool card shows every row, not only the last few. */
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  /** Bring the agent terminal forward: where permission prompts are answered. */
  readonly onReveal: () => void;
  /** The composer, pinned under the log. */
  readonly composer?: React.ReactNode;
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

/** A tool row: its name and target (cut with an ellipsis when long), the edit's size beside them, never cut, and the duration. */
const ToolRow: React.FC<{ readonly tool: PaneTool }> = ({ tool }) => {
  const target = plainTarget(tool);
  return (
    <li className="spexr-agent-tool" data-state={tool.state}>
      <span className={`codicon ${toolIcon(tool)} spexr-agent-tool__icon`} aria-hidden="true" />
      <span className="spexr-agent-tool__text" title={tool.path ?? target}>
        {tool.verb ?? tool.name}
        {target ? <b className="spexr-agent-tool__target"> {target}</b> : null}
      </span>
      {tool.added !== undefined || tool.removed !== undefined ? <DiffStat added={tool.added} removed={tool.removed} /> : null}
      <span className="spexr-agent-tool__meta">{meta(tool)}</span>
    </li>
  );
};

/** Words with their backtick spans set as inline code, as the demo sets `cache.write`. */
const Prose: React.FC<{ readonly text: string }> = ({ text }) => (
  <>
    {inlineCode(text).map((part, i) =>
      part.code ? (
        <code key={i} className="sl-code">
          {part.text}
        </code>
      ) : (
        <React.Fragment key={i}>{part.text}</React.Fragment>
      ),
    )}
  </>
);

/** The head's title: the session's name, or a placeholder until it has one. */
const titleOf = (s: AgentPaneSnapshot): string => s.title ?? nls.localize("spexr/agentPane/untitled", "New session");

const TOOLS_LIST_ID = "spexr-agent-tools-list";

export const AgentPaneEmpty: React.FC<{ readonly onReveal: () => void; readonly composer?: React.ReactNode }> = ({ onReveal, composer }) => (
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
    {composer}
  </section>
);

/**
 * The agent pane, read-only: Lumen's right pane as a view of the followed
 * session's snapshot. A head (the session's id, its name and its model), the
 * prompt, the agent's latest words, a card of the turn's tool calls, the
 * latest diff and the plan; a row asking the user to come to the terminal when
 * the agent waits for them. Nothing here animates in.
 */
export const AgentPaneView: React.FC<AgentPaneViewProps> = ({ snapshot, expanded, onToggleExpanded, onReveal, composer }) => {
  if (!snapshot) return <AgentPaneEmpty onReveal={onReveal} composer={composer} />;
  const turn = snapshot.turn;
  const family = modelFamily(snapshot.model);
  const prose = turn?.prose?.[turn.prose.length - 1];
  const tools = turn?.tools ?? [];
  const { shown } = visibleTools(tools, expanded);
  const foldable = tools.length - TOOL_ROWS_SHOWN;
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
        {turn?.prompt ? (
          <p className="spexr-agent-prompt" title={turn.prompt}>
            {turn.prompt}
          </p>
        ) : null}
        {prose ? (
          <p className="spexr-agent-prose">
            <Prose text={prose} />
          </p>
        ) : null}
        {shown.length > 0 ? (
          <div className="spexr-agent-tools">
            {foldable > 0 ? (
              <button type="button" className="spexr-agent-tools__fold" aria-expanded={expanded} aria-controls={TOOLS_LIST_ID} onClick={onToggleExpanded}>
                {nls.localize("spexr/agentPane/earlier", "{0} earlier", foldable)}
              </button>
            ) : null}
            <ol id={TOOLS_LIST_ID} className="spexr-agent-tools__list" aria-label={nls.localize("spexr/agentPane/tools", "Tool calls")}>
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
                <span key={i} className={`spexr-agent-diff__row spexr-agent-diff__row--${line.startsWith("+") ? "add" : "del"}`} title={line}>
                  {line}
                </span>
              ))}
            </pre>
          </figure>
        ) : null}
        {snapshot.plan && snapshot.plan.length > 0 ? (
          <div className="spexr-agent-plan">
            <span className="sl-eyebrow" id="spexr-agent-plan-title">
              {nls.localize("spexr/agentPane/plan", "Plan")}
            </span>
            <ul className="spexr-agent-plan__list" aria-labelledby="spexr-agent-plan-title">
              {snapshot.plan.map((item, i) => (
                <li key={i} className="spexr-agent-plan__item">
                  <label className="sl-check" onClick={(e) => e.preventDefault()}>
                    <input className="sl-check__input" type="checkbox" checked={item.done} readOnly aria-readonly="true" tabIndex={-1} onChange={noop} />
                    <span className="sl-check__box" />
                    <span className="sl-check__label">{item.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {composer}
    </section>
  );
};
