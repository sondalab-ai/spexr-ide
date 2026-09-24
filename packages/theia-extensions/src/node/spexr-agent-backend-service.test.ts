import { describe, it, expect, vi } from "vitest";
import * as os from "os";
import * as path from "path";
import {
  stripFrontmatter,
  formatGitContext,
  resolveMemoryPaths,
  SpexrAgentBackendService,
} from "./spexr-agent-backend-service.js";
import type { DescriptionGenerator } from "./search/description-format.js";
import type { GitStatusDto } from "../common/git-protocol.js";

describe("stripFrontmatter", () => {
  it("returns the body after a frontmatter block", () => {
    const md = "---\nid: review\nname: Revisione\n---\nYou are the Review expert.\n";
    expect(stripFrontmatter(md).trim()).toBe("You are the Review expert.");
  });

  it("returns the input unchanged when there is no frontmatter", () => {
    expect(stripFrontmatter("no frontmatter here")).toBe("no frontmatter here");
  });
});

describe("formatGitContext", () => {
  it("shows clean when no files changed", () => {
    const status: GitStatusDto = {
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [],
      isClean: true,
      mergeInProgress: false,
    };
    const result = formatGitContext(status);
    expect(result).toContain("branch=main");
    expect(result).toContain("Working tree clean.");
  });

  it("shows staged/modified/untracked counts", () => {
    const status: GitStatusDto = {
      branch: "feat/x",
      upstream: "origin/feat/x",
      ahead: 1,
      behind: 0,
      isClean: false,
      mergeInProgress: false,
      files: [
        { path: "a.ts", stagedState: "A" },
        { path: "b.ts", unstagedState: "M" },
        { path: "c.ts", unstagedState: "?" },
      ],
    };
    const result = formatGitContext(status);
    expect(result).toContain("branch=feat/x");
    expect(result).toContain("upstream=origin/feat/x");
    expect(result).toContain("ahead=1");
    expect(result).toContain("Staged: 1 file");
    expect(result).toContain("Modified: 1 file");
    expect(result).toContain("Untracked: 1 file");
  });

  it("reports conflicted files separately and flags the merge", () => {
    const status: GitStatusDto = {
      branch: "feat/x",
      ahead: 0,
      behind: 0,
      isClean: false,
      mergeInProgress: true,
      files: [
        { path: "a.ts", unstagedState: "U" },
        { path: "b.ts", unstagedState: "M" },
      ],
    };
    const result = formatGitContext(status);
    expect(result).toContain("Conflicted: 1 file");
    expect(result).toContain("Modified: 1 file");
    expect(result).toContain("resolve the conflicted files");
  });

  it("does not claim a merge is in progress when none is", () => {
    const status: GitStatusDto = {
      branch: "main",
      ahead: 0,
      behind: 0,
      isClean: false,
      mergeInProgress: false,
      files: [{ path: "b.ts", unstagedState: "M" }],
    };
    expect(formatGitContext(status)).not.toContain("merge is in progress");
  });

  it("never calls the tree clean while a merge is open", () => {
    // Accepting the deletion on a delete/modify conflict resolves it by staging
    // nothing, so the status is empty with the merge still uncommitted.
    const status: GitStatusDto = {
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [],
      isClean: true,
      mergeInProgress: true,
    };
    const result = formatGitContext(status);
    expect(result).not.toContain("Working tree clean");
    expect(result).toContain("nothing left to resolve");
  });
});

describe("resolveMemoryPaths", () => {
  const root = "/Users/x/proj";

  it("expands a home-relative config dir instead of using it as a path", () => {
    // Left unexpanded, `~/.claude-perso/...` is a *relative* path: fs resolves
    // it against the process cwd and creates a literal `~` directory there.
    const { target } = resolveMemoryPaths(root, "~/.claude-perso");

    expect(target.startsWith(path.join(os.homedir(), ".claude-perso"))).toBe(true);
    expect(target).not.toContain("~");
  });

  it("keeps an absolute config dir as given", () => {
    const { target } = resolveMemoryPaths(root, "/Users/x/.claude-work");

    expect(target).toBe(path.join("/Users/x/.claude-work", "projects", "-Users-x-proj", "memory"));
  });

  it("falls back to the default account when no config dir is given", () => {
    const { target } = resolveMemoryPaths(root);

    expect(target).toBe(
      path.join(os.homedir(), ".claude", "projects", "-Users-x-proj", "memory"),
    );
  });

  it("links the workspace docs/memory folder", () => {
    expect(resolveMemoryPaths(root).source).toBe(path.join(root, "docs", "memory"));
  });
});

describe("suggestExpert", () => {
  function withModel(model: Partial<DescriptionGenerator>): SpexrAgentBackendService {
    const svc = new SpexrAgentBackendService();
    (svc as unknown as { generator: Partial<DescriptionGenerator> }).generator = {
      isAvailable: () => true,
      ...model,
    };
    return svc;
  }

  it("returns the expert the local model picks among the candidates", async () => {
    const prompts: string[] = [];
    const svc = withModel({
      summarize: async (prompt, kind) => {
        prompts.push(`${kind}:${prompt}`);
        return "software-engineering";
      },
    });
    expect(await svc.suggestExpert("Fix the card height", ["design", "software-engineering"])).toBe(
      "software-engineering",
    );
    expect(prompts[0]).toMatch(/^route:Experts:/);
    expect(prompts[0]).not.toContain("- marketing:");
  });

  it("asks nothing when no candidate is a known expert", async () => {
    let asked = false;
    const svc = withModel({
      summarize: async () => {
        asked = true;
        return "design";
      },
    });
    expect(await svc.suggestExpert("anything", ["not-an-expert"])).toBeUndefined();
    expect(asked).toBe(false);
  });

  it("falls back to no expert when the model is unavailable", async () => {
    const svc = withModel({ isAvailable: () => false });
    expect(await svc.suggestExpert("anything", ["design"])).toBeUndefined();
  });

  it("stops waiting for a model that does not answer in time", async () => {
    vi.useFakeTimers();
    try {
      const svc = withModel({ summarize: () => new Promise<string | null>(() => {}) });
      const pending = svc.suggestExpert("anything", ["design"]);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await pending).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
