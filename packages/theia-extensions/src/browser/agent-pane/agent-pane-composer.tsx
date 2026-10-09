import * as React from "react";
import { nls } from "@theia/core/lib/common/nls";
import type { ComposerState } from "./agent-pane-composer-model.js";

export interface AgentPaneComposerProps {
  readonly draft: string;
  readonly onDraft: (text: string) => void;
  /** The active editor's file, for the chip; undefined with no editor open. */
  readonly file: { readonly name: string; readonly path: string } | undefined;
  readonly chipPressed: boolean;
  readonly onChip: () => void;
  /** The agent is in plan mode, as the transcript's permission-mode says. */
  readonly planPressed: boolean;
  readonly state: ComposerState;
  readonly onSend: () => void;
  readonly onPlan: () => void;
  /** For a pane that follows another session: open it in a terminal. */
  readonly onOpenInTerminal: () => void;
}

/**
 * The composer: Lumen's message box at the foot of the agent pane. It types
 * into the agent terminal's TUI, so it is a keyboard with a field: Enter
 * sends, Shift+Enter breaks the line, Plan is Shift+Tab. On another session
 * than the agent terminal's it is only "Open in terminal".
 */
export const AgentPaneComposer: React.FC<AgentPaneComposerProps> = (p) => {
  const { state } = p;
  const reasonId = "spexr-agent-composer-reason";
  if (state.mode === "open") {
    return (
      <form className="spexr-agent-composer spexr-agent-composer--open" onSubmit={(e) => e.preventDefault()}>
        <p className="spexr-agent-composer__note">{nls.localize("spexr/agentPane/readOnlySession", "This session is not the agent terminal's: it can be read here, and continued in a terminal.")}</p>
        <div className="spexr-agent-composer__bar">
          <span className="spexr-agent-composer__spacer" />
          <button type="button" className="sl-btn sl-btn--primary sl-btn--sm" onClick={p.onOpenInTerminal}>
            {nls.localize("spexr/agentPane/openInTerminal", "Open in terminal")}
          </button>
        </div>
      </form>
    );
  }
  return (
    <form
      className="spexr-agent-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (state.canSend) p.onSend();
      }}
    >
      <label className="spexr-agent-composer__field">
        <span className="spexr-sr-only">{nls.localize("spexr/agentPane/message", "Message")}</span>
        <textarea
          className="spexr-agent-composer__input"
          rows={2}
          value={p.draft}
          placeholder={nls.localize("spexr/agentPane/placeholder", "Ask, or @ a file…")}
          aria-describedby={state.reason ? reasonId : undefined}
          onChange={(e) => p.onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (state.canSend) p.onSend();
          }}
        />
      </label>
      {state.reason ? (
        <p id={reasonId} className="spexr-agent-composer__note" role="status">
          {state.reason === "needs-you"
            ? nls.localize("spexr/agentPane/sendBlocked", "Waiting for you in the terminal: answer there first.")
            : state.reason === "untrusted"
              ? nls.localize("spexr/agentPane/trust", "Trust this workspace to start the agent.")
              : nls.localize("spexr/agentPane/working", "Agent is working")}
        </p>
      ) : null}
      <div className="spexr-agent-composer__bar">
        {p.file ? (
          <button type="button" className="sl-chip spexr-agent-composer__chip" aria-pressed={p.chipPressed} title={p.file.path} onClick={p.onChip}>
            @{p.file.name}
          </button>
        ) : null}
        <span className="spexr-agent-composer__spacer" />
        <button type="button" className="sl-btn sl-btn--ghost sl-btn--sm" aria-pressed={p.planPressed} disabled={!state.canPlan} onClick={p.onPlan}>
          {nls.localize("spexr/agentPane/plan", "Plan")}
        </button>
        <button type="submit" className="sl-btn sl-btn--primary sl-btn--sm" disabled={!state.canSend}>
          {nls.localize("spexr/agentPane/send", "Send")}
          <kbd className="sl-kbd" aria-hidden="true">{"⏎"}</kbd>
        </button>
      </div>
    </form>
  );
};
