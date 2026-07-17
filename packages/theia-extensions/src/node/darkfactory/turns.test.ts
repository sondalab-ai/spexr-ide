import { describe, expect, it } from "vitest";
import { buildTurnsText } from "./turns.js";

describe("buildTurnsText", () => {
  it("renders tool_use with its target and keeps the last N events plus the goal", () => {
    const entries = [
      { message: { role: "user", content: "first" } },
      { message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
      { message: { role: "user", content: "second" } },
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "/x/auth.ts" } }] } },
      { message: { role: "user", content: "third" } },
    ];
    // last 2 events → [assistant: [Edit auth.ts], user: third]; goal "user: first" prepended.
    expect(buildTurnsText(entries, 2)).toBe("user: first\nassistant: [Edit auth.ts]\nuser: third");
  });

  it("returns an empty string for no entries", () => {
    expect(buildTurnsText([], 5)).toBe("");
  });

  it("keeps a legitimate prompt whose content ends in a colon", () => {
    const entries = [{ message: { role: "user", content: "Steps:" } }];
    expect(buildTurnsText(entries, 1)).toBe("user: Steps:");
  });

  it("renders the bash command as the tool target", () => {
    const entries = [
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: `NODE_ENV=test pnpm --filter x test` } }] } },
    ];
    expect(buildTurnsText(entries, 5)).toBe("assistant: [Bash: pnpm --filter x test]");
  });

  it("surfaces failed tool results and drops successful ones", () => {
    const entries = [
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm build" } }] } },
      { message: { role: "user", content: [{ type: "tool_result", is_error: true, content: "TS2345: type mismatch" }] } },
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "/x/a.ts" } }] } },
      { message: { role: "user", content: [{ type: "tool_result", is_error: false, content: "file body here" }] } },
    ];
    expect(buildTurnsText(entries, 10)).toBe(
      "assistant: [Bash: pnpm build]\ntool error: TS2345: type mismatch\nassistant: [Read a.ts]",
    );
  });

  it("drops injected and meta user prompts", () => {
    const entries = [
      { isMeta: true, message: { role: "user", content: "<command-name>compact</command-name>" } },
      { message: { role: "user", content: "## Context\nsome injected block" } },
      { message: { role: "user", content: "real instruction" } },
    ];
    expect(buildTurnsText(entries, 10)).toBe("user: real instruction");
  });
});

describe("describeToolUse", () => {
  it("keeps a stripped bash command, a basename for file tools, and a raw pattern for search", async () => {
    const { describeToolUse } = await import("./action-distiller.js");
    expect(describeToolUse("Bash", { command: `FOO=1 git push origin main` })).toBe("Bash: git push origin main");
    expect(describeToolUse("Edit", { file_path: "/a/b/auth.ts" })).toBe("Edit auth.ts");
    expect(describeToolUse("Grep", { pattern: "authToken" })).toBe("Grep authToken");
    expect(describeToolUse("Bash", undefined)).toBe("Bash");
  });
});
