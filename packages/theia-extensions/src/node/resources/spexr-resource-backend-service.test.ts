import { describe, expect, it, vi } from "vitest";
import { SAMPLE_MS, SpexrResourceBackendService, type ResourceServiceDeps } from "./spexr-resource-backend-service.js";

/** `ps` output for a main process (10) and the backend (20) under it, with the given CPU seconds each. */
function psOutput(mainCpu: number, backendCpu: number): string {
  return `10 1 1024 0:${mainCpu.toFixed(2)} SPEXR\n20 10 2048 0:${backendCpu.toFixed(2)} node backend\n`;
}

function service(overrides: Partial<ResourceServiceDeps> = {}) {
  let clock = 0;
  const outputs = [psOutput(1, 1), psOutput(1.5, 1.25), psOutput(2, 2)];
  const runPs = vi.fn(async () => outputs.shift() ?? psOutput(2, 2));
  const svc = new SpexrResourceBackendService({
    runPs,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    rootPid: 10,
    backendPid: 20,
    platform: "darwin",
    ...overrides,
  });
  return { svc, runPs, advance: (ms: number) => (clock += ms) };
}

describe("SpexrResourceBackendService", () => {
  it("samples twice on the first call so CPU is already measured", async () => {
    const { svc, runPs } = service();
    const usage = await svc.usage();
    expect(runPs).toHaveBeenCalledTimes(2);
    // 0.75 s of CPU over the 0.75 s gap.
    expect(usage?.total.cpuPercent).toBeCloseTo(100);
    expect(usage?.total.rssBytes).toBe(3 * 1024 * 1024);
  });

  it("serves a fresh sample from cache and shares one in flight", async () => {
    const { svc, runPs, advance } = service();
    await Promise.all([svc.usage(), svc.usage()]);
    expect(runPs).toHaveBeenCalledTimes(2);
    advance(SAMPLE_MS - 1);
    await svc.usage();
    expect(runPs).toHaveBeenCalledTimes(2);
    advance(1);
    await svc.usage();
    expect(runPs).toHaveBeenCalledTimes(3);
  });

  it("answers undefined on Windows and when ps fails", async () => {
    expect(await service({ platform: "win32" }).svc.usage()).toBeUndefined();
    expect(await service({ runPs: async () => Promise.reject(new Error("no ps")) }).svc.usage()).toBeUndefined();
  });
});
