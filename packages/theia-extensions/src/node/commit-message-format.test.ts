import { describe, expect, test } from "vitest";
import {
  buildCommitPrompt,
  cleanCommitSubject,
  commitPrefix,
  splitDiffByFile,
  type StagedFile,
} from "./commit-message-format.js";

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

  test("scopes to the folder most of the change lives in, not the shared parent", () => {
    expect(
      commitPrefix([
        file("packages/ext/src/browser/darkfactory/agent-tile.tsx"),
        file("packages/ext/src/browser/darkfactory/darkfactory-format.ts"),
        file("packages/ext/src/browser/darkfactory/darkfactory-wall-widget.tsx"),
        file("packages/ext/src/browser/style/spexr.css"),
      ]),
    ).toBe("fix(darkfactory)");
  });

  test("treats the layer folders as containers, like src and packages", () => {
    expect(commitPrefix([file("packages/ext/src/browser/thing.ts")])).toBe("fix(ext)");
    expect(commitPrefix([file("packages/ext/src/node/thing.ts")])).toBe("fix(ext)");
    expect(commitPrefix([file("packages/ext/src/common/thing.ts")])).toBe("fix(ext)");
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

describe("splitDiffByFile", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 111..222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,0 +2 @@",
    "+export function added(): void {}",
    "-export function gone(): void {}",
    "diff --git a/docs/b.md b/docs/b.md",
    "--- a/docs/b.md",
    "+++ b/docs/b.md",
    "@@ -3 +3 @@",
    "+a new sentence",
  ].join("\n");

  test("captures each file's added and removed lines", () => {
    const out = splitDiffByFile(diff);
    expect(out.map((s) => s.path)).toEqual(["src/a.ts", "docs/b.md"]);
    expect(out[0]!.added).toBe("export function added(): void {}");
    expect(out[0]!.removed).toBe("export function gone(): void {}");
    expect(out[1]!.added).toBe("a new sentence");
  });

  test("keeps the ---/+++ headers out of the captured lines", () => {
    const out = splitDiffByFile(diff);
    expect(out[0]!.added).not.toContain("b/src/a.ts");
    expect(out[0]!.removed).not.toContain("a/src/a.ts");
  });

  test("names a deleted file by its pre-image path", () => {
    const out = splitDiffByFile(
      ["diff --git a/src/old.ts b/src/old.ts", "--- a/src/old.ts", "+++ /dev/null", "@@ -1 +0,0 @@", "-const x = 1;"].join(
        "\n",
      ),
    );
    expect(out[0]!.path).toBe("src/old.ts");
  });

  test("an empty diff yields no files", () => {
    expect(splitDiffByFile("")).toEqual([]);
  });
});

describe("buildCommitPrompt", () => {
  const codeDiff = [
    "diff --git a/src/app/thing.ts b/src/app/thing.ts",
    "--- a/src/app/thing.ts",
    "+++ b/src/app/thing.ts",
    "@@ -1,2 +1,2 @@",
    "+export function shinyHelper(): void {}",
    "-export function dustyHelper(): void {}",
  ].join("\n");

  test("names the declarations the change adds and drops", () => {
    const prompt = buildCommitPrompt([file("src/app/thing.ts")], codeDiff);
    expect(prompt).toContain("shinyHelper");
    expect(prompt).toContain("dustyHelper");
  });

  test("still lists the staged paths with their status letter", () => {
    const prompt = buildCommitPrompt([file("src/app/thing.ts", "A")], codeDiff);
    expect(prompt).toContain("A src/app/thing.ts");
  });

  test("leaves a declaration out of both lists when it was only edited", () => {
    const edited = [
      "diff --git a/src/app/thing.ts b/src/app/thing.ts",
      "--- a/src/app/thing.ts",
      "+++ b/src/app/thing.ts",
      "@@ -1 +1 @@",
      "+export function sameName(a: number): void {}",
      "-export function sameName(): void {}",
    ].join("\n");
    const prompt = buildCommitPrompt([file("src/app/thing.ts")], edited);
    expect(prompt).not.toContain("sameName");
  });

  test("ignores a test file's declarations, which scaffold the change rather than being it", () => {
    const withTest = [
      codeDiff,
      "diff --git a/src/app/thing.test.ts b/src/app/thing.test.ts",
      "--- a/src/app/thing.test.ts",
      "+++ b/src/app/thing.test.ts",
      "@@ -1 +1,2 @@",
      "+const scaffoldingName = 1;",
    ].join("\n");
    const prompt = buildCommitPrompt([file("src/app/thing.ts"), file("src/app/thing.test.ts", "A")], withTest);
    expect(prompt).toContain("shinyHelper");
    expect(prompt).not.toContain("scaffoldingName");
  });

  test("falls back to the test declarations when tests are all the change has", () => {
    const onlyTest = [
      "diff --git a/src/app/thing.test.ts b/src/app/thing.test.ts",
      "--- a/src/app/thing.test.ts",
      "+++ b/src/app/thing.test.ts",
      "@@ -1 +1,2 @@",
      "+const scaffoldingName = 1;",
    ].join("\n");
    const prompt = buildCommitPrompt([file("src/app/thing.test.ts", "A")], onlyTest);
    expect(prompt).toContain("scaffoldingName");
  });

  test("drops the added text once the change names declarations", () => {
    const mixed = [
      codeDiff,
      "diff --git a/docs/guide.md b/docs/guide.md",
      "--- a/docs/guide.md",
      "+++ b/docs/guide.md",
      "@@ -1 +1,2 @@",
      "+## Running the migration",
    ].join("\n");
    const prompt = buildCommitPrompt([file("src/app/thing.ts"), file("docs/guide.md")], mixed);
    expect(prompt).toContain("shinyHelper");
    expect(prompt).not.toContain("## Running the migration");
  });

  test("takes the added text of a prose file rather than hunting for declarations", () => {
    const prose = [
      "diff --git a/docs/guide.md b/docs/guide.md",
      "--- a/docs/guide.md",
      "+++ b/docs/guide.md",
      "@@ -1 +1,2 @@",
      "+## Running the migration",
    ].join("\n");
    const prompt = buildCommitPrompt([file("docs/guide.md")], prose);
    expect(prompt).toContain("## Running the migration");
  });

  const proseDiff = (path: string, lines: readonly string[]): string =>
    [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, "@@ -1 +1,2 @@", ...lines.map((l) => `+${l}`)].join(
      "\n",
    );

  test("never shows the same added line twice", () => {
    const diff = [
      proseDiff("docs/a.md", ["updatedAt: 2026-08-29", "status: ship"]),
      proseDiff("docs/b.md", ["updatedAt: 2026-08-29", "status: ship"]),
    ].join("\n");
    const prompt = buildCommitPrompt([file("docs/a.md"), file("docs/b.md")], diff);
    expect(prompt.match(/updatedAt: 2026-08-29/g)).toHaveLength(1);
  });

  test("lets every changed file speak before any file speaks twice", () => {
    const diff = [
      proseDiff("docs/loud.md", Array.from({ length: 12 }, (_, i) => `loud line ${i}`)),
      proseDiff("docs/quiet.md", ["the one line that matters"]),
    ].join("\n");
    const prompt = buildCommitPrompt([file("docs/loud.md"), file("docs/quiet.md")], diff);
    expect(prompt).toContain("the one line that matters");
  });

  test("caps a large changeset and says how many paths were left out", () => {
    const files = Array.from({ length: 25 }, (_, i) => file(`src/f${i}.ts`));
    const prompt = buildCommitPrompt(files, "");
    expect(prompt).toContain("src/f11.ts");
    expect(prompt).not.toContain("src/f12.ts");
    expect(prompt).toContain("13 more files");
  });
});
