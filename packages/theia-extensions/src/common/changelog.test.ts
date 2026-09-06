import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseChangelog } from "./changelog.js";

const REPO_CHANGELOG = fileURLToPath(new URL("../../../../CHANGELOG.md", import.meta.url));

describe("parseChangelog", () => {
  it("reads version, date, tagline and bullets of a release", () => {
    const notes = parseChangelog(
      ["## 0.2.0 — 2026-08-01", "> a tagline", "", "- first change", "- second change"].join("\n"),
    );

    expect(notes).toEqual([
      {
        version: "0.2.0",
        date: "2026-08-01",
        tagline: "a tagline",
        changes: ["first change", "second change"],
      },
    ]);
  });

  it("keeps file order across releases", () => {
    const notes = parseChangelog(
      ["## 0.2.0 — 2026-08-01", "- newer", "", "## 0.1.0 — 2026-06-14", "- older"].join("\n"),
    );

    expect(notes.map((n) => n.version)).toEqual(["0.2.0", "0.1.0"]);
    expect(notes[1].changes).toEqual(["older"]);
  });

  it("flattens bullets across section headings", () => {
    const notes = parseChangelog(
      [
        "## 0.2.0 — 2026-08-01",
        "### Features",
        "- a feature",
        "### Fixes",
        "- a fix",
        "### Internals",
        "- a chore",
      ].join("\n"),
    );

    expect(notes[0].changes).toEqual(["a feature", "a fix", "a chore"]);
  });

  it("strips bold markers but leaves inline links untouched", () => {
    const notes = parseChangelog(
      ["## 0.2.0 — 2026-08-01", "- **Update check** — see [docs](https://example.com/x)"].join(
        "\n",
      ),
    );

    expect(notes[0].changes).toEqual(["Update check — see [docs](https://example.com/x)"]);
  });

  it("keeps only the first blockquote as tagline", () => {
    const notes = parseChangelog(
      ["## 0.2.0 — 2026-08-01", "> the tagline", "> a later quote"].join("\n"),
    );

    expect(notes[0].tagline).toBe("the tagline");
  });

  it("takes only the first line of a multi-line blockquote", () => {
    const notes = parseChangelog(
      ["## 0.2.0 — 2026-08-01", "> first line", "second line", "- a change"].join("\n"),
    );

    expect(notes[0].tagline).toBe("first line");
    expect(notes[0].changes).toEqual(["a change"]);
  });

  it("leaves the tagline undefined when the blockquote is empty", () => {
    const notes = parseChangelog(["## 0.2.0 — 2026-08-01", ">", "- a change"].join("\n"));

    expect(notes[0].tagline).toBeUndefined();
  });

  it("leaves the tagline undefined when the release has none", () => {
    const notes = parseChangelog(["## 0.2.0 — 2026-08-01", "- a change"].join("\n"));

    expect(notes[0].tagline).toBeUndefined();
  });

  it("ignores the preamble before the first release heading", () => {
    const notes = parseChangelog(
      ["# Changelog", "> not a tagline", "- not a change", "", "## 0.2.0 — 2026-08-01"].join("\n"),
    );

    expect(notes).toEqual([{ version: "0.2.0", date: "2026-08-01", changes: [] }]);
  });

  it("ignores headings that are not a version/date pair", () => {
    expect(parseChangelog("## Unreleased\n- a change")).toEqual([]);
  });

  it("returns nothing for empty input", () => {
    expect(parseChangelog("")).toEqual([]);
  });

  // Guards the shape of the real file: released entries never change, newer
  // ones are prepended, so only the historical tail is asserted verbatim.
  it("parses the repository changelog the way the generated file did", () => {
    const notes = parseChangelog(readFileSync(REPO_CHANGELOG, "utf8"));

    expect(notes.map((n) => n.version)).toEqual(
      expect.arrayContaining(["0.1.5", "0.1.3", "0.1.2", "0.1.1", "0.1.0"]),
    );
    expect(notes.at(-1)).toMatchObject({ version: "0.1.0", date: "2026-06-14" });
    expect(notes.find((n) => n.version === "0.1.5")).toMatchObject({
      date: "2026-07-02",
      tagline: "Smarter search, tighter security, lazier release notes",
    });
    expect(notes.find((n) => n.version === "0.1.3")?.changes[0]).toMatch(
      /^Update check — replaced `electron-updater`/,
    );
    expect(notes.every((n) => n.changes.length > 0)).toBe(true);
  });
});
