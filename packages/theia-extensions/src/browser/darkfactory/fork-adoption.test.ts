import { describe, expect, it } from "vitest";
import { resolveForks, type PendingFork } from "./fork-adoption.js";

const tile = (sessionId: string, projectPath = "/p", lastActivityMs = 0) => ({
  sessionId,
  projectPath,
  lastActivityMs,
});

const fork = (fromId: string, knownBefore: string[], projectPath = "/p"): PendingFork => ({
  fromId,
  projectPath,
  knownBefore: new Set(knownBefore),
});

describe("resolveForks", () => {
  it("moves a forked card onto the session the fork wrote", () => {
    const { adopted, pending } = resolveForks([fork("orig", ["orig"])], ["orig"], [tile("orig"), tile("forked")]);
    expect(adopted).toEqual([{ fromId: "orig", toId: "forked" }]);
    expect(pending).toEqual([]);
  });

  it("waits while the fork has not written its transcript yet", () => {
    const pending = [fork("orig", ["orig"])];
    const result = resolveForks(pending, ["orig"], [tile("orig")]);
    expect(result.adopted).toEqual([]);
    expect(result.pending).toEqual(pending);
  });

  it("ignores sessions in other projects and sessions that existed before the fork", () => {
    const result = resolveForks(
      [fork("orig", ["orig", "older"])],
      ["orig"],
      [tile("orig"), tile("older"), tile("elsewhere", "/other")],
    );
    expect(result.adopted).toEqual([]);
  });

  it("forgets a fork whose card was closed", () => {
    const result = resolveForks([fork("orig", ["orig"])], [], [tile("orig"), tile("forked")]);
    expect(result).toEqual({ adopted: [], pending: [] });
  });

  it("does not move a card onto a session that already has its own card", () => {
    const result = resolveForks([fork("orig", ["orig"])], ["orig", "forked"], [tile("orig"), tile("forked")]);
    expect(result.adopted).toEqual([]);
    expect(result.pending).toHaveLength(1);
  });
});
