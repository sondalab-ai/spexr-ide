import { describe, expect, test } from "vitest";
import URI from "@theia/core/lib/common/uri";
import {
  groupByRoot,
  locateSpec,
  rootContaining,
  specContextDirFor,
  specDirPrefixes,
  specDirsForRoots,
  specGroupsFor,
} from "./spec-roots.js";

const root = (path: string): URI => new URI(`file://${path}`);

describe("specDirsForRoots", () => {
  test("pairs every root with every spec collection, root order first", () => {
    const dirs = specDirsForRoots([root("/w/a"), root("/w/b")]);
    expect(dirs.map((d) => d.specsDir.toString())).toEqual([
      "file:///w/a/docs/specs",
      "file:///w/a/docs/superpowers/specs",
      "file:///w/b/docs/specs",
      "file:///w/b/docs/superpowers/specs",
    ]);
    expect(dirs[0]!.root.toString()).toBe("file:///w/a");
    expect(dirs[2]!.root.toString()).toBe("file:///w/b");
  });

  test("no roots yields no directories", () => {
    expect(specDirsForRoots([])).toEqual([]);
  });
});

describe("specDirPrefixes", () => {
  test("covers every root so a watcher sees edits outside the first folder", () => {
    expect(specDirPrefixes([root("/w/a"), root("/w/b")])).toEqual([
      "file:///w/a/docs/specs/",
      "file:///w/a/docs/superpowers/specs/",
      "file:///w/b/docs/specs/",
      "file:///w/b/docs/superpowers/specs/",
    ]);
  });
});

describe("locateSpec", () => {
  const roots = [root("/w/a"), root("/w/b")];

  test("finds the owning root of a spec in a later folder", () => {
    const located = locateSpec(roots, new URI("file:///w/b/docs/specs/0001-auth.md"));
    expect(located?.root.toString()).toBe("file:///w/b");
    expect(located?.specsDir.toString()).toBe("file:///w/b/docs/specs");
  });

  test("keeps colliding slugs apart across folders", () => {
    const a = locateSpec(roots, new URI("file:///w/a/docs/specs/0001-auth.md"));
    const b = locateSpec(roots, new URI("file:///w/b/docs/specs/0001-auth.md"));
    expect(a?.root.toString()).not.toBe(b?.root.toString());
  });

  test("recognises the superpowers layout", () => {
    const located = locateSpec(roots, new URI("file:///w/a/docs/superpowers/specs/0002-x.md"));
    expect(located?.specsDir.toString()).toBe("file:///w/a/docs/superpowers/specs");
  });

  test("rejects a file outside any spec directory", () => {
    expect(locateSpec(roots, new URI("file:///w/a/docs/0001-auth.md"))).toBeUndefined();
  });

  test("rejects a file whose name is not a spec filename", () => {
    expect(locateSpec(roots, new URI("file:///w/a/docs/specs/README.md"))).toBeUndefined();
  });

  test("rejects a spec-looking file nested deeper, such as inside .context", () => {
    const uri = new URI("file:///w/a/docs/specs/.context/0001-auth/0001-auth.md");
    expect(locateSpec(roots, uri)).toBeUndefined();
  });

  test("rejects a URI from another scheme", () => {
    expect(locateSpec(roots, new URI("untitled:/w/a/docs/specs/0001-auth.md"))).toBeUndefined();
  });

  test("prefers the deepest root when one folder nests inside another", () => {
    const nested = [root("/w/a"), root("/w/a/sub")];
    const located = locateSpec(nested, new URI("file:///w/a/sub/docs/specs/0001-x.md"));
    expect(located?.root.toString()).toBe("file:///w/a/sub");
  });

  test("does not let one root swallow a sibling sharing its prefix", () => {
    const siblings = [root("/w/repo"), root("/w/repo-other")];
    const located = locateSpec(siblings, new URI("file:///w/repo-other/docs/specs/0001-x.md"));
    expect(located?.root.toString()).toBe("file:///w/repo-other");
  });
});

describe("groupByRoot", () => {
  const item = (rootUri: string, name: string) => ({ rootUri, name });

  test("orders groups by workspace root order, not by item order", () => {
    const items = [item("file:///w/b", "b1"), item("file:///w/a", "a1")];
    const groups = groupByRoot(items, [root("/w/a"), root("/w/b")]);
    expect(groups.map((g) => g.label)).toEqual(["a", "b"]);
    expect(groups[0]!.items.map((i) => i.name)).toEqual(["a1"]);
  });

  test("omits roots that hold no specs", () => {
    const groups = groupByRoot([item("file:///w/a", "a1")], [root("/w/a"), root("/w/b")]);
    expect(groups.map((g) => g.label)).toEqual(["a"]);
  });

  test("keeps items whose root left the workspace, listed last", () => {
    const items = [item("file:///w/gone", "g1"), item("file:///w/a", "a1")];
    const groups = groupByRoot(items, [root("/w/a")]);
    expect(groups.map((g) => g.label)).toEqual(["a", "gone"]);
  });

  test("decodes an escaped folder name for display", () => {
    const groups = groupByRoot([item("file:///w/my%20repo", "x")], [root("/w/my%20repo")]);
    expect(groups[0]!.label).toBe("my repo");
  });

  test("no items yields no groups", () => {
    expect(groupByRoot([], [root("/w/a")])).toEqual([]);
  });
});

describe("rootContaining", () => {
  const roots = [root("/w/a"), root("/w/b")];

  test("names the folder holding the given file", () => {
    const found = rootContaining(roots, new URI("file:///w/b/src/index.ts"));
    expect(found?.toString()).toBe("file:///w/b");
  });

  test("is undefined with no file to go on, so the caller can ask", () => {
    expect(rootContaining(roots, undefined)).toBeUndefined();
  });

  test("is undefined for a file outside every folder", () => {
    expect(rootContaining(roots, new URI("file:///elsewhere/x.ts"))).toBeUndefined();
  });

  test("ignores a file from another scheme, such as an unsaved editor", () => {
    expect(rootContaining(roots, new URI("untitled:/w/a/Untitled-1"))).toBeUndefined();
  });

  test("returns the folder itself when the URI is that folder", () => {
    expect(rootContaining(roots, root("/w/a"))?.toString()).toBe("file:///w/a");
  });

  test("prefers the deepest folder when folders nest", () => {
    const nested = [root("/w/a"), root("/w/a/sub")];
    const found = rootContaining(nested, new URI("file:///w/a/sub/src/x.ts"));
    expect(found?.toString()).toBe("file:///w/a/sub");
  });
});

describe("specContextDirFor", () => {
  const roots = [root("/w/a"), root("/w/b")];

  test("resolves beside the spec's own collection", () => {
    const dir = specContextDirFor(roots, new URI("file:///w/a/docs/specs/0001-auth.md"));
    expect(dir?.toString()).toBe("file:///w/a/docs/specs/.context/0001-auth");
  });

  // Regression: resolving through the first workspace folder made deleting
  // folder B's 0001-auth.md remove folder A's context folder of the same slug.
  test("never crosses into another folder holding the same slug", () => {
    const dir = specContextDirFor(roots, new URI("file:///w/b/docs/specs/0001-auth.md"));
    expect(dir?.toString()).toBe("file:///w/b/docs/specs/.context/0001-auth");
  });

  test("keeps a superpowers-layout spec's context beside that layout", () => {
    const uri = new URI("file:///w/a/docs/superpowers/specs/0002-x.md");
    expect(specContextDirFor(roots, uri)?.toString()).toBe(
      "file:///w/a/docs/superpowers/specs/.context/0002-x",
    );
  });

  test("is undefined for a file that is not a spec of this workspace", () => {
    expect(specContextDirFor(roots, new URI("file:///w/a/README.md"))).toBeUndefined();
  });
});

describe("specGroupsFor", () => {
  const spec = (rootUri: string) => ({ rootUri });

  test("stays flat in a single-folder workspace", () => {
    expect(specGroupsFor([spec("file:///w/a")], [root("/w/a")])).toEqual([]);
  });

  test("stays flat with no workspace at all", () => {
    expect(specGroupsFor([], [])).toEqual([]);
  });

  test("groups once a second folder is open, even if only one holds specs", () => {
    const groups = specGroupsFor([spec("file:///w/a")], [root("/w/a"), root("/w/b")]);
    expect(groups.map((g) => g.label)).toEqual(["a"]);
  });
});
