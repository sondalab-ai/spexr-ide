import { describe, it, expect } from "vitest";
import {
  allDeleteModifyConflicts,
  allInGroup,
  allSingleOutcomeConflicts,
  isResourceGroup,
  resourceGroupId,
  resourcePaths,
} from "./scm-resource-args.js";

function resource(path: string, groupId?: string): unknown {
  return {
    sourceUri: { path: { toString: () => path } },
    group: groupId === undefined ? undefined : { id: groupId },
  };
}

describe("resourcePaths", () => {
  it("resolves three resources passed as separate spread arguments", () => {
    // Regresses the bug where a single `arg: unknown` parameter silently
    // dropped every resource past the first on a multi-select invocation.
    const args = [resource("/w/repo/a.ts"), resource("/w/repo/b.ts"), resource("/w/repo/c.ts")];
    expect(resourcePaths("/w/repo", args)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("deduplicates two rows that resolve to the same repo-relative path", () => {
    const args = [resource("/w/repo/a.ts", "index"), resource("/w/repo/a.ts", "workingTree")];
    expect(resourcePaths("/w/repo", args)).toEqual(["a.ts"]);
  });

  it("converts absolute sourceUri paths to repository-relative paths", () => {
    expect(resourcePaths("/w/repo", [resource("/w/repo/src/nested/file.ts")])).toEqual([
      "src/nested/file.ts",
    ]);
  });

  it("ignores items with no usable sourceUri", () => {
    expect(resourcePaths("/w/repo", [{}, undefined, null])).toEqual([]);
  });
});

describe("resourceGroupId", () => {
  it("reads the group id off a resource", () => {
    expect(resourceGroupId(resource("/w/repo/a.ts", "workingTree"))).toBe("workingTree");
  });

  it("returns undefined when there is no group", () => {
    expect(resourceGroupId({})).toBeUndefined();
  });
});

describe("allInGroup", () => {
  it("is true when every item belongs to the given group", () => {
    const args = [resource("/w/repo/a.ts", "workingTree"), resource("/w/repo/b.ts", "workingTree")];
    expect(allInGroup(args, "workingTree")).toBe(true);
  });

  it("is false when at least one item belongs to a different group", () => {
    const args = [resource("/w/repo/a.ts", "workingTree"), resource("/w/repo/b.ts", "index")];
    expect(allInGroup(args, "workingTree")).toBe(false);
  });

  it("is false for an empty selection", () => {
    expect(allInGroup([], "workingTree")).toBe(false);
  });

  it("scopes the conflicts group to itself, e.g. for markResolved's visibility gate", () => {
    const args = [resource("/w/repo/a.ts", "conflicts")];
    expect(allInGroup(args, "conflicts")).toBe(true);
    expect(allInGroup(args, "workingTree")).toBe(false);
  });
});

describe("isResourceGroup", () => {
  it("is true for a single ScmResourceGroup argument matching the id", () => {
    expect(isResourceGroup([{ id: "workingTree" }], "workingTree")).toBe(true);
  });

  it("is false when the group id differs", () => {
    expect(isResourceGroup([{ id: "index" }], "workingTree")).toBe(false);
  });

  it("is true for an empty selection, so the command palette (which passes no args) still lists it", () => {
    expect(isResourceGroup([], "workingTree")).toBe(true);
  });

  it("is false for a spread list of resources rather than a single group", () => {
    expect(isResourceGroup([{ id: "workingTree" }, { id: "workingTree" }], "workingTree")).toBe(
      false,
    );
  });
});

/** A conflict row as the SCM tree spreads it into a command handler. */
function conflictRow(path: string, conflict?: string): unknown {
  return {
    sourceUri: { path: { toString: () => path } },
    group: { id: "conflicts" },
    ...(conflict !== undefined && { conflict }),
  };
}

describe("conflict resolution predicates", () => {
  it.each(["UD", "DU"])("treats %s as a two-resolution conflict", (kind) => {
    const rows = [conflictRow("/r/f.txt", kind)];
    expect(allDeleteModifyConflicts(rows)).toBe(true);
    expect(allSingleOutcomeConflicts(rows)).toBe(false);
  });

  it.each(["UU", "AA", "DD", "AU", "UA"])("treats %s as resolved by staging", (kind) => {
    const rows = [conflictRow("/r/f.txt", kind)];
    expect(allDeleteModifyConflicts(rows)).toBe(false);
    expect(allSingleOutcomeConflicts(rows)).toBe(true);
  });

  it("falls back to staging for a row carrying no conflict kind", () => {
    const rows = [conflictRow("/r/f.txt")];
    expect(allDeleteModifyConflicts(rows)).toBe(false);
    expect(allSingleOutcomeConflicts(rows)).toBe(true);
  });

  it("offers neither resolution for a mixed selection", () => {
    const rows = [conflictRow("/r/a.txt", "UD"), conflictRow("/r/b.txt", "UU")];
    expect(allDeleteModifyConflicts(rows)).toBe(false);
    expect(allSingleOutcomeConflicts(rows)).toBe(false);
  });

  it("is false outside the conflicts group and on an empty selection", () => {
    const staged = {
      sourceUri: { path: { toString: () => "/r/f.txt" } },
      group: { id: "index" },
      conflict: "UD",
    };
    expect(allDeleteModifyConflicts([staged])).toBe(false);
    expect(allSingleOutcomeConflicts([staged])).toBe(false);
    expect(allDeleteModifyConflicts([])).toBe(false);
    expect(allSingleOutcomeConflicts([])).toBe(false);
  });
});
