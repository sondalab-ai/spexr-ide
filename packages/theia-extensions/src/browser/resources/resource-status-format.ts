import type { ResourceGroup, ResourceUsage } from "../../common/resource-protocol.js";

/** Bytes as MB below a GB, GB with one decimal above. */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb < 1024 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}

/** The status bar text, e.g. "$(pulse) 1.2 GB · 14%". */
export function formatResourceEntry(u: ResourceUsage): string {
  return `$(pulse) ${formatBytes(u.total.rssBytes)} · ${Math.round(u.total.cpuPercent)}%`;
}

/**
 * The hover: one line per group, then how to read the numbers. Memory is the
 * sum of each process's resident size, which counts memory Electron's
 * processes share more than once, so it reads above Activity Monitor.
 */
export function formatResourceTooltip(u: ResourceUsage): string {
  const line = (label: string, g: ResourceGroup): string =>
    `${label}: ${formatBytes(g.rssBytes)}, ${Math.round(g.cpuPercent)}% CPU (${g.processes} ${g.processes === 1 ? "process" : "processes"})`;
  return [
    line("SPEXR", u.app),
    line("Model workers", u.models),
    line("Terminals and agents", u.terminals),
    "",
    "CPU is per core: 100% is one core fully busy. Memory is summed per process, so memory processes share is counted more than once.",
  ].join("\n");
}
