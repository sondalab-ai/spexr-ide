import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const own = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

// A toast in the window's corner went unnoticed on a big screen, so "Nothing staged"
// read as the button doing nothing. The refusals say it under the commit box.
describe("generate commit message feedback", () => {
  const source = own("./git-commands-contribution.ts");
  const body = source.slice(source.indexOf("private async generateCommitMessage"), source.indexOf("True when `op` completed"));

  it("says each refusal under the commit box, not in a corner toast", () => {
    for (const text of ["Nothing staged", "already has text", "could not write a commit message"]) {
      expect(body, text).toMatch(new RegExp(`this\\.notice\\(provider,\\s*"[^"]*${text}`));
    }
    expect(body).not.toMatch(/this\.messages\.info\("(Nothing staged|The commit message box|The local model)/);
  });

  it("shows the notice as the input's information issue and drops it when the box is edited", () => {
    const provider = own("./git-scm-provider.ts");
    expect(provider).toMatch(/input\.issue = issue/);
    expect(provider).toMatch(/type: ScmInputIssueType\.Information/);
    expect(provider).toMatch(/repository\.input\.onDidChange\([\s\S]*?clearInputNotice\(\)/);
  });
});
