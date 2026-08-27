import { describe, expect, test } from "vitest";
import type { HarnessAdapter, HarnessId } from "./harness-types.js";
import { installedHarnesses, resolveActiveHarness } from "./harness-registry.js";

function stub(id: HarnessId): HarnessAdapter {
  return {
    id,
    processNames: () => [id],
    isResumableId: () => true,
    buildResumeArgs: (s) => ["--resume", s],
  };
}
const claude = stub("claude");
const opencode = stub("opencode");
const all = [claude, opencode];
const detect = (ids: string[]) => (a: HarnessAdapter) => ids.includes(a.id);

describe("harness-registry", () => {
  test("none installed → no active", () => {
    expect(installedHarnesses(all, detect([]))).toEqual([]);
    expect(resolveActiveHarness(all, detect([]))).toBeUndefined();
  });

  test("one installed → that one, preference ignored", () => {
    expect(resolveActiveHarness(all, detect(["opencode"]), "claude")).toBe(opencode);
  });

  test("both installed → preferred wins", () => {
    expect(resolveActiveHarness(all, detect(["claude", "opencode"]), "opencode")).toBe(opencode);
  });

  test("both installed, no/invalid preference → first installed", () => {
    expect(resolveActiveHarness(all, detect(["claude", "opencode"]))).toBe(claude);
  });
});
