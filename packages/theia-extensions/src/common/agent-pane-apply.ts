import type { AgentPaneDelta, AgentPaneSnapshot, PaneTool } from "./agent-pane-protocol.js";

/**
 * The snapshot a client holds after a delta, as AgentPaneDelta defines it:
 * tools are merged by id (known ones replaced in place, new ones appended),
 * every other field present replaces the field whole. A delta for another
 * session changes nothing.
 */
export function applyDelta(snapshot: AgentPaneSnapshot, delta: AgentPaneDelta): AgentPaneSnapshot {
  if (delta.sessionId !== snapshot.sessionId) return snapshot;
  const { sessionId: _id, tools, prose, diff, plan, planSource, ...scalars } = delta;
  const next: AgentPaneSnapshot = { ...snapshot };
  for (const [key, value] of Object.entries(scalars)) {
    if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
  }
  if (plan) {
    next.plan = plan;
    if (planSource) next.planSource = planSource;
  }
  if (tools || prose || diff) {
    const merged: PaneTool[] = [...(snapshot.turn?.tools ?? [])];
    for (const tool of tools ?? []) {
      const at = merged.findIndex((t) => t.id === tool.id);
      if (at >= 0) merged[at] = tool;
      else merged.push(tool);
    }
    next.turn = {
      ...snapshot.turn,
      ...(tools ? { tools: merged } : {}),
      ...(prose ? { prose } : {}),
      ...(diff ? { diff } : {}),
    };
  }
  return next;
}
