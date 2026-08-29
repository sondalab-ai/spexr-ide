import { describe, expect, test } from "vitest";
import { buildCommitPrompt, cleanCommitSubject, commitPrefix, type StagedFile } from "./commit-message-format.js";

const file = (path: string, state: StagedFile["state"] = "M"): StagedFile => ({ path, state });

describe("commitPrefix", () => {
  test("names the deepest meaningful shared folder as the scope", () => {
    expect(
      commitPrefix([
        file("packages/theia-extensions/src/browser/darkfactory/agent-tile.tsx"),
        file("packages/theia-extensions/src/browser/darkfactory/darkfactory-format.ts"),
      ]),
    ).toBe("fix(darkfactory)");
  });

  test("skips container folders that say nothing about the change", () => {
    expect(
      commitPrefix([
        file("packages/theia-extensions/src/browser/scm/git-client.ts"),
        file("packages/theia-extensions/src/node/spexr-git-backend-service.ts"),
      ]),
    ).toBe("fix(theia-extensions)");
  });

  test("leaves the scope out when the change spans the repo root", () => {
    expect(commitPrefix([file("README.md"), file("package.json")])).toBe("fix");
  });

  test("a new file makes it a feature", () => {
    expect(commitPrefix([file("src/app/thing.ts", "A"), file("src/app/other.ts")])).toBe("feat(app)");
  });

  test("a fix that adds only a regression test is still a fix", () => {
    expect(commitPrefix([file("src/app/thing.ts"), file("src/app/thing.test.ts", "A")])).toBe("fix(app)");
  });

  test("an all-test change is a test change, new files included", () => {
    expect(commitPrefix([file("src/app/thing.test.ts", "A"), file("test/helpers.ts")])).toBe("test");
  });

  test("an all-markdown change is a docs change", () => {
    expect(commitPrefix([file("docs/specs/0014-git-hardening.md"), file("docs/specs/0012.md")])).toBe("docs(specs)");
  });

  test("no staged files yields no prefix", () => {
    expect(commitPrefix([])).toBe("");
  });
});

describe("cleanCommitSubject", () => {
  test("lowercases the opening word and drops the trailing period", () => {
    expect(cleanCommitSubject("Group the wall by project.")).toBe("group the wall by project");
  });

  test("strips a prefix the model wrote itself, since the caller composes one", () => {
    expect(cleanCommitSubject("feat(darkfactory): group the wall by project")).toBe("group the wall by project");
  });

  test("strips quotes, markdown and a leading label", () => {
    expect(cleanCommitSubject('**Commit message:** "add the toolbar button"')).toBe("add the toolbar button");
  });

  test("takes the first non-empty line of a chatty reply", () => {
    expect(cleanCommitSubject("\nrename the scope helper\nThis change also...")).toBe("rename the scope helper");
  });

  test("an empty or label-only reply yields nothing", () => {
    expect(cleanCommitSubject("  \n**Subject:**\n")).toBe("");
  });
});

describe("buildCommitPrompt", () => {
  test("lists the staged paths with their git status letter", () => {
    const prompt = buildCommitPrompt([file("src/a.ts", "A"), file("src/b.ts", "D")]);
    expect(prompt).toContain("A src/a.ts");
    expect(prompt).toContain("D src/b.ts");
  });

  test("caps a large changeset and says how many were left out", () => {
    const files = Array.from({ length: 25 }, (_, i) => file(`src/f${i}.ts`));
    const prompt = buildCommitPrompt(files);
    expect(prompt).toContain("src/f19.ts");
    expect(prompt).not.toContain("src/f20.ts");
    expect(prompt).toContain("5 more files");
  });
});
