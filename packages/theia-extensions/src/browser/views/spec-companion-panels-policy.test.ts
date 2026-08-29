import { describe, expect, it } from "vitest";
import {
  SpexrSpecCompanionPanelsPolicy,
  type SpecCompanionPanel,
} from "./spec-companion-panels-policy.js";

interface Harness {
  policy: SpexrSpecCompanionPanelsPolicy;
  calls: string[];
  /** Marks a panel hidden the way selecting another bottom tab does. */
  hide: (name: string) => void;
}

function makeHarness(names: readonly string[]): Harness {
  const calls: string[] = [];
  const visible = new Map(names.map((name) => [name, false]));
  const panels: SpecCompanionPanel[] = names.map((name) => ({
    isVisible: () => visible.get(name) ?? false,
    reveal: async () => {
      calls.push(`reveal:${name}`);
      visible.set(name, true);
    },
    close: () => {
      calls.push(`close:${name}`);
      visible.set(name, false);
    },
  }));
  return {
    policy: new SpexrSpecCompanionPanelsPolicy(panels),
    calls,
    hide: (name) => visible.set(name, false),
  };
}

describe("SpexrSpecCompanionPanelsPolicy", () => {
  it("reveals every panel in order when a spec comes to the front", async () => {
    const h = makeHarness(["lint", "resources"]);

    await h.policy.sync("file:///0012.md");

    expect(h.calls).toEqual(["reveal:lint", "reveal:resources"]);
  });

  it("does not re-reveal a panel hidden while the same spec stays in front", async () => {
    const h = makeHarness(["lint", "resources"]);
    await h.policy.sync("file:///0012.md");
    h.calls.length = 0;
    h.hide("lint");
    h.hide("resources");

    await h.policy.sync("file:///0012.md");

    expect(h.calls).toEqual([]);
  });

  it("closes the visible panels when the main area leaves the spec editor", async () => {
    const h = makeHarness(["lint", "resources"]);
    await h.policy.sync("file:///0012.md");
    h.calls.length = 0;
    h.hide("lint");

    await h.policy.sync(undefined);

    expect(h.calls).toEqual(["close:resources"]);
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
