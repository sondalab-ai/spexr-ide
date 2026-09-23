import { describe, expect, it } from "vitest";
import { isHighlightable } from "./code-highlight.js";

describe("isHighlightable", () => {
  it("accepts shell blocks, which specs use for commands", () => {
    expect(isHighlightable("language-bash")).toBe(true);
    expect(isHighlightable("language-sh")).toBe(true);
    expect(isHighlightable("language-zsh")).toBe(true);
    expect(isHighlightable("language-shell")).toBe(true);
  });

  it("accepts other languages common in specs", () => {
    for (const lang of ["yaml", "yml", "diff", "css", "sql", "markdown", "md", "ts", "json"]) {
      expect(isHighlightable(`language-${lang}`), lang).toBe(true);
    }
  });

  it("skips a block whose language is not registered", () => {
    expect(isHighlightable("language-cobol")).toBe(false);
    expect(isHighlightable("lang-brainfuck")).toBe(false);
  });

  it("lets untagged blocks through to auto-detection", () => {
    expect(isHighlightable("")).toBe(true);
  });
});
