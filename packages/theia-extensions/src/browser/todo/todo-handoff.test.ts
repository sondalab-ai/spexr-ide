import { describe, expect, it } from "vitest";
import { buildTodoHandoff } from "./todo-handoff.js";

describe("buildTodoHandoff", () => {
  it("names the file and line, carries the item, and asks for the tick when done", () => {
    const prompt = buildTodoHandoff({
      path: "TODO.md",
      line: 3,
      title: "Group subagent sessions under their parent",
      details: "Transcripts live under the parent's folder.",
    });
    expect(prompt).toContain("TODO.md, line 4");
    expect(prompt).toContain("Group subagent sessions under their parent");
    expect(prompt).toContain("Transcripts live under the parent's folder.");
    expect(prompt).toContain("- [x]");
  });

  it("leaves out an empty details block", () => {
    const prompt = buildTodoHandoff({ path: "TODO.md", line: 0, title: "Tidy up", details: "" });
    expect(prompt).not.toMatch(/\n\n\n/);
    expect(prompt).toContain("Tidy up");
  });
});
