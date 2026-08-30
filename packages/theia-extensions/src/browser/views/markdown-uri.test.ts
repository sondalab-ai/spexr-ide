import { describe, expect, it } from "vitest";
import { isMarkdownPath } from "./markdown-uri.js";

describe("isMarkdownPath", () => {
  it("accepts a plain markdown file", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
  });

  it("accepts the long extension", () => {
    expect(isMarkdownPath("notes.markdown")).toBe(true);
  });

  it("ignores extension case", () => {
    expect(isMarkdownPath("CHANGELOG.MD")).toBe(true);
  });

  it("accepts a spec file, which is markdown too", () => {
    expect(isMarkdownPath("0014-git-hardening.md")).toBe(true);
  });

  it("rejects a non-markdown file", () => {
    expect(isMarkdownPath("index.ts")).toBe(false);
  });

  it("rejects a name that only contains the extension mid-way", () => {
    expect(isMarkdownPath("readme.md.bak")).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(isMarkdownPath("")).toBe(false);
  });
});
