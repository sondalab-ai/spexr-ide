import type { PaneTool } from "../../common/agent-pane-protocol.js";
import { AGENT_PANE } from "../shell/workbench-geometry.js";

/** How many tool rows the card shows before it folds the earlier ones: Lumen's four. */
export const TOOL_ROWS_SHOWN = AGENT_PANE.toolRows;

/** The family of a model id for the head's tag (`claude-opus-5-5` is `Opus`); the id itself when it names none. */
export function modelFamily(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const family = /(opus|sonnet|haiku|fable)/i.exec(model)?.[1];
  if (!family) return model;
  return family[0]!.toUpperCase() + family.slice(1).toLowerCase();
}

/** The first six characters of a session id, the head's eyebrow. */
export function shortId(sessionId: string): string {
  return sessionId.replace(/-/g, "").slice(0, 6);
}

/** A duration the way the tool card writes it: `0.2 s`, `12 s`, `1 m 05 s`. */
export function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, "0")} s`;
}

/** The codicon a tool's row wears: by what it does, not by what it is called. */
export function toolIcon(tool: PaneTool): string {
  switch (tool.verb) {
    case "Read":
      return "codicon-file";
    case "Edit":
    case "Write":
      return "codicon-edit";
    case "Run":
      return "codicon-terminal";
    case "Search":
    case "Find":
    case "Search web":
      return "codicon-search";
    case "Delegate":
      return "codicon-sparkle";
    case "Fetch":
      return "codicon-globe";
    default:
      return "codicon-tools";
  }
}

/** A tool's target as it should read: a search pattern's regex escapes taken out (`cache\\.write` reads `cache.write`). */
export function plainTarget(tool: PaneTool): string | undefined {
  if (!tool.target) return undefined;
  return tool.verb === "Search" || tool.verb === "Find" ? tool.target.replace(/\\(.)/g, "$1") : tool.target;
}

/** Text split at its backtick spans, so the view can set the spans as inline code; an unmatched backtick stays text. */
export function inlineCode(text: string): Array<{ readonly code: boolean; readonly text: string }> {
  const out: Array<{ code: boolean; text: string }> = [];
  const re = /`([^`\n]+)`/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ code: false, text: text.slice(at, m.index) });
    out.push({ code: true, text: m[1]! });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ code: false, text: text.slice(at) });
  return out;
}

/** The rows the card shows and how many it folded: the last few, or all when expanded. */
export function visibleTools(tools: readonly PaneTool[], expanded: boolean): { shown: readonly PaneTool[]; hidden: number } {
  if (expanded || tools.length <= TOOL_ROWS_SHOWN) return { shown: tools, hidden: 0 };
  return { shown: tools.slice(-TOOL_ROWS_SHOWN), hidden: tools.length - TOOL_ROWS_SHOWN };
}
