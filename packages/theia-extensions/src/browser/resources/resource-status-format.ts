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

/** One formatted line of the hover table. `share` is the row's fraction of total memory, 0 to 1. */
export interface ResourceRow {
  readonly label: string;
  readonly memory: string;
  readonly cpu: string;
  readonly processes: string;
  readonly share: number;
}

/** The hover table's content: one row per group, then the total. */
export function resourceRows(u: ResourceUsage): { groups: ResourceRow[]; total: ResourceRow } {
  const row = (label: string, g: ResourceGroup): ResourceRow => ({
    label,
    memory: formatBytes(g.rssBytes),
    cpu: `${Math.round(g.cpuPercent)}%`,
    processes: String(g.processes),
    share: u.total.rssBytes > 0 ? Math.min(1, g.rssBytes / u.total.rssBytes) : 0,
  });
  return {
    groups: [row("SPEXR", u.app), row("Model workers", u.models), row("Terminals & agents", u.terminals)],
    total: row("Total", u.total),
  };
}

/** The entry's screen-reader label, since the hover itself is an element. */
export function formatResourceLabel(u: ResourceUsage): string {
  return `SPEXR resources: ${formatBytes(u.total.rssBytes)} memory, ${Math.round(u.total.cpuPercent)}% CPU`;
}

/**
 * The hover: a table of memory, CPU and process count per group with a bar
 * for each group's share of memory, then how to read the numbers. Memory is
 * the sum of each process's resident size, which counts memory Electron's
 * processes share more than once, so it reads above Activity Monitor.
 */
export function renderResourceTooltip(u: ResourceUsage, intervalMs: number): HTMLElement {
  const el = (tag: string, className: string, text?: string): HTMLElement => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const line = (modifier: string, texts: readonly string[], bar: HTMLElement): HTMLElement => {
    const row = el("div", `spexr-telemetry__row spexr-telemetry__row--${modifier}`);
    const [label, ...nums] = texts;
    row.append(el("span", "spexr-telemetry__label", label), ...nums.map((t) => el("span", "spexr-telemetry__num", t)), bar);
    return row;
  };
  const shareBar = (share: number): HTMLElement => {
    const track = el("span", "spexr-telemetry__bar");
    const fill = el("span", "spexr-telemetry__fill");
    fill.style.width = `${(share * 100).toFixed(1)}%`;
    track.append(fill);
    return track;
  };
  const values = (r: ResourceRow): string[] => [r.label, r.memory, r.cpu, r.processes];

  const { groups, total } = resourceRows(u);
  const header = el("div", "spexr-telemetry__header");
  header.append(
    el("span", "spexr-telemetry__title", "Resources"),
    el("span", "spexr-telemetry__meta", `sampled every ${Math.round(intervalMs / 1000)} s`),
  );
  const table = el("div", "spexr-telemetry__table");
  table.append(
    line("head", ["", "Memory", "CPU", "Procs"], el("span", "spexr-telemetry__label", "Share")),
    ...groups.map((g) => line("group", values(g), shareBar(g.share))),
    line("total", values(total), el("span", "spexr-telemetry__bar-spacer")),
  );
  const root = el("div", "spexr-telemetry");
  root.append(
    header,
    table,
    el("p", "spexr-telemetry__note", "CPU is per core: 100% is one core fully busy."),
    el("p", "spexr-telemetry__note", "Memory is summed per process, so memory that processes share counts more than once."),
  );
  return root;
}
