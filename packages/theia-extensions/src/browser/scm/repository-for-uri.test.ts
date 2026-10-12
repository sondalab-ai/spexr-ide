import { describe, expect, it } from "vitest";
import { repositoryRootFor } from "./repository-for-uri.js";

const roots = ["file:///src/spexr", "file:///src/sondalab-site", "file:///src/spexr/vendor/lib"];

describe("repositoryRootFor", () => {
  it("finds the repository that holds a file", () => {
    expect(repositoryRootFor(roots, "file:///src/spexr/packages/a.ts")).toBe("file:///src/spexr");
    expect(repositoryRootFor(roots, "file:///src/sondalab-site")).toBe("file:///src/sondalab-site");
  });

  it("prefers the deepest root, so a nested repository owns its own files", () => {
    expect(repositoryRootFor(roots, "file:///src/spexr/vendor/lib/x.c")).toBe("file:///src/spexr/vendor/lib");
  });

  it("does not match a sibling that shares a name prefix", () => {
    expect(repositoryRootFor(["file:///src/spexr"], "file:///src/spexr-wt/a.ts")).toBeUndefined();
  });

  it("is undefined outside every repository", () => {
    expect(repositoryRootFor(roots, "file:///elsewhere/a.ts")).toBeUndefined();
  });
});
