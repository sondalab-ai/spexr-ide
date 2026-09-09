import { describe, expect, it } from "vitest";
import { buildSessionDoc, projectTail, toolTargets } from "./session-doc.js";

describe("projectTail", () => {
  it("keeps the last two segments so sibling projects stay distinguishable", () => {
    expect(projectTail("/Users/me/src/mine/spexr")).toBe("mine/spexr");
    expect(projectTail("/spexr")).toBe("spexr");
    expect(projectTail("")).toBe("");
  });
});

describe("toolTargets", () => {
  it("collects file paths, patterns and the leading word of commands, deduplicated in order", () => {
    const entries = [
      {
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", name: "Edit", input: { file_path: "/p/src/theme.css" } },
            { type: "tool_use", name: "Bash", input: { command: "pnpm test --filter ui" } },
            { type: "tool_use", name: "Grep", input: { pattern: "--color-accent" } },
            { type: "tool_use", name: "Edit", input: { file_path: "/p/src/theme.css" } },
          ],
        },
      },
    ];
    expect(toolTargets(entries)).toEqual(["/p/src/theme.css", "pnpm", "--color-accent"]);
  });

  it("ignores messages without tool_use blocks", () => {
    expect(toolTargets([{ message: { role: "user", content: "hello" } }])).toEqual([]);
  });
});

describe("buildSessionDoc", () => {
  it("puts the goal first and the project, branch, prose and targets after it", () => {
    const doc = buildSessionDoc({
      projectPath: "/Users/me/src/mine/spexr",
      gitBranch: "feat/effects",
      goal: "add new effects to the design system",
      prose: ["Added a glow token", "Wired the hover transition"],
      targets: ["/p/src/theme.css", "pnpm"],
    });
    expect(doc.startsWith("add new effects to the design system")).toBe(true);
    expect(doc).toContain("spexr");
    expect(doc).toContain("mine/spexr");
    expect(doc).toContain("feat/effects");
    expect(doc).toContain("Added a glow token");
    expect(doc).toContain("/p/src/theme.css");
  });

  it("caps the document at 4000 characters, dropping targets before the goal", () => {
    const doc = buildSessionDoc({
      projectPath: "/p/spexr",
      goal: "G".repeat(500),
      prose: ["P".repeat(3600)],
      targets: Array.from({ length: 500 }, (_, i) => `/p/file-${i}.ts`),
    });
    expect(doc.length).toBe(4000);
    expect(doc.startsWith("G".repeat(500))).toBe(true);
    expect(doc).not.toContain("/p/file-39.ts");
  });

  it("tolerates an empty session", () => {
    expect(buildSessionDoc({ projectPath: "", goal: "", prose: [], targets: [] })).toBe("");
  });
});
