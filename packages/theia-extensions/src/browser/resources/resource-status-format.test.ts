import { describe, expect, it } from "vitest";
import { formatBytes, formatResourceEntry, formatResourceTooltip } from "./resource-status-format.js";
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

describe("formatResourceTooltip", () => {
  it("breaks the total down by group and explains the figures", () => {
    const tip = formatResourceTooltip(usage);
    expect(tip).toContain("SPEXR: 1000 MB, 10% CPU (5 processes)");
    expect(tip).toContain("Model workers: 36 MB, 0% CPU (1 process)");
    expect(tip).toContain("Terminals and agents: 500 MB, 4% CPU (2 processes)");
    expect(tip).toContain("per core");
  });
});
