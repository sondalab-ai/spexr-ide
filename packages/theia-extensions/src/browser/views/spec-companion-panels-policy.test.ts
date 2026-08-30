import { describe, expect, it } from "vitest";
import {
  SpexrSpecCompanionPanelsPolicy,
  type SpecCompanionPanel,
} from "./spec-companion-panels-policy.js";

interface Harness {
  policy: SpexrSpecCompanionPanelsPolicy;
  calls: string[];
}

function makeHarness(names: readonly string[]): Harness {
  const calls: string[] = [];
  const panels: SpecCompanionPanel[] = names.map((name) => ({
    reveal: async () => {
      calls.push(`reveal:${name}`);
    },
    close: () => {
      calls.push(`close:${name}`);
    },
  }));
  return { policy: new SpexrSpecCompanionPanelsPolicy(panels), calls };
}

describe("SpexrSpecCompanionPanelsPolicy", () => {
  it("reveals every panel in order when a spec comes to the front", async () => {
    const h = makeHarness(["lint", "resources"]);

    await h.policy.sync("file:///0012.md");

    expect(h.calls).toEqual(["reveal:lint", "reveal:resources"]);
  });

  it("does nothing while the same spec stays in front", async () => {
    const h = makeHarness(["lint", "resources"]);
    await h.policy.sync("file:///0012.md");
    h.calls.length = 0;

    await h.policy.sync("file:///0012.md");

    expect(h.calls).toEqual([]);
  });

  it("closes every panel when the main area leaves the spec editor", async () => {
    // Regression: only the panel in front used to be closed, so spec validation
    // — always revealed behind linked resources — stayed as an open tab.
    const h = makeHarness(["lint", "resources"]);
    await h.policy.sync("file:///0012.md");
    h.calls.length = 0;

    await h.policy.sync(undefined);

    expect(h.calls).toEqual(["close:lint", "close:resources"]);
  });

  it("reveals again after leaving and returning to the same spec", async () => {
    const h = makeHarness(["lint", "resources"]);
    await h.policy.sync("file:///0012.md");
    await h.policy.sync(undefined);
    h.calls.length = 0;

    await h.policy.sync("file:///0012.md");

    expect(h.calls).toEqual(["reveal:lint", "reveal:resources"]);
  });

  it("reveals when switching from one spec to another", async () => {
    const h = makeHarness(["lint", "resources"]);
    await h.policy.sync("file:///0012.md");
    h.calls.length = 0;

    await h.policy.sync("file:///0013.md");

    expect(h.calls).toEqual(["reveal:lint", "reveal:resources"]);
  });

  it("serializes overlapping syncs so reveals never interleave", async () => {
    const h = makeHarness(["lint", "resources"]);

    await Promise.all([h.policy.sync("file:///0012.md"), h.policy.sync("file:///0013.md")]);

    expect(h.calls).toEqual([
      "reveal:lint",
      "reveal:resources",
      "reveal:lint",
      "reveal:resources",
    ]);
  });
});
