import type { AgentSession, AgentState } from "../../common/darkfactory-protocol.js";

/** Coarse "time ago" bucket for a past epoch-ms timestamp. */
export function relativeTime(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Human label for a session state. */
export function stateLabel(state: AgentState): string {
  return state === "live" ? "Live" : state === "idle" ? "Idle" : "Archived";
}

/** CSS custom property carrying the status colour for a state. */
export function stateColor(state: AgentState): string {
  return state === "live"
    ? "var(--spexr-df-live)"
    : state === "idle"
      ? "var(--spexr-df-idle)"
      : "var(--spexr-df-archived)";
}

/** Sessions of one project, in first-seen order. */
export interface ProjectGroup {
  projectPath: string;
  projectName: string;
  sessions: AgentSession[];
}

/** Cluster sessions by project path, preserving first-seen order of both groups and sessions. */
export function groupByProject(agents: AgentSession[]): ProjectGroup[] {
  const groups: ProjectGroup[] = [];
  const byPath = new Map<string, ProjectGroup>();
  for (const a of agents) {
    let g = byPath.get(a.projectPath);
    if (!g) {
      g = { projectPath: a.projectPath, projectName: a.projectName, sessions: [] };
      byPath.set(a.projectPath, g);
      groups.push(g);
    }
    g.sessions.push(a);
  }
  return groups;
}
