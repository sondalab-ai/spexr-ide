import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatBytes,
  formatResourceEntry,
  formatResourceLabel,
  renderResourceTooltip,
  resourceRows,
} from "./resource-status-format.js";
import type { ResourceUsage } from "../../common/resource-protocol.js";

const MB = 1024 * 1024;
const usage: ResourceUsage = {
  total: { rssBytes: 1536 * MB, cpuPercent: 14.4, processes: 8 },
  app: { rssBytes: 1000 * MB, cpuPercent: 10, processes: 5 },
  models: { rssBytes: 36 * MB, cpuPercent: 0, processes: 1 },
  terminals: { rssBytes: 500 * MB, cpuPercent: 4.4, processes: 2 },
};

describe("formatBytes", () => {
  it("shows MB below a GB and GB with one decimal from there", () => {
    expect(formatBytes(512.4 * MB)).toBe("512 MB");
    expect(formatBytes(1023 * MB)).toBe("1023 MB");
    expect(formatBytes(1024 * MB)).toBe("1.0 GB");
  });
});

describe("formatResourceEntry", () => {
  it("shows total memory and CPU", () => {
    expect(formatResourceEntry(usage)).toBe("$(pulse) 1.5 GB · 14%");
  });
});

describe("resourceRows", () => {
  it("formats each group and its share of total memory", () => {
    const { groups, total } = resourceRows(usage);
    expect(groups.map((g) => [g.label, g.memory, g.cpu, g.processes])).toEqual([
      ["SPEXR", "1000 MB", "10%", "5"],
      ["Model workers", "36 MB", "0%", "1"],
      ["Terminals & agents", "500 MB", "4%", "2"],
    ]);
    expect(groups.map((g) => g.share.toFixed(3))).toEqual(["0.651", "0.023", "0.326"]);
    expect(total).toMatchObject({ label: "Total", memory: "1.5 GB", cpu: "14%", processes: "8", share: 1 });
  });

  it("reports no share when nothing is resident", () => {
    const zero = { rssBytes: 0, cpuPercent: 0, processes: 0 };
    const { groups } = resourceRows({ total: zero, app: zero, models: zero, terminals: zero });
    expect(groups.every((g) => g.share === 0)).toBe(true);
  });
});

describe("formatResourceLabel", () => {
  it("summarises the total for screen readers", () => {
    expect(formatResourceLabel(usage)).toBe("SPEXR resources: 1.5 GB memory, 14% CPU");
  });
});

/** The slice of a DOM element the renderer touches. */
class FakeNode {
  className = "";
  textContent = "";
  readonly style: Record<string, string> = {};
  readonly children: FakeNode[] = [];
  constructor(readonly tagName: string) {}
  append(...nodes: FakeNode[]): void {
    this.children.push(...nodes);
  }
  find(cls: string): FakeNode[] {
    const own = this.className.split(" ").includes(cls) ? [this] : [];
    return [...own, ...this.children.flatMap((c) => c.find(cls))];
  }
}

describe("renderResourceTooltip", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lays out a header, a row per group plus total, and the reading notes", () => {
    vi.stubGlobal("document", { createElement: (tag: string) => new FakeNode(tag) });
    const root = renderResourceTooltip(usage, 4_000) as unknown as FakeNode;
    expect(root.find("spexr-telemetry__meta")[0]?.textContent).toBe("sampled every 4 s");
    const rows = root.find("spexr-telemetry__row");
    expect(rows).toHaveLength(5);
    expect(rows[4]?.children.map((c) => c.textContent)).toEqual(["Total", "1.5 GB", "14%", "8", ""]);
    expect(root.find("spexr-telemetry__fill").map((f) => f.style.width)).toEqual(["65.1%", "2.3%", "32.6%"]);
    expect(root.find("spexr-telemetry__note").map((n) => n.textContent).join(" ")).toContain("per core");
  });
});
