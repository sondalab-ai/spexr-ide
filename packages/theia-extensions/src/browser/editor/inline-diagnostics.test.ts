import { describe, expect, it } from "vitest";
import { displayWidth, isWide, plainTextBlock, INLINE_CHROME_COLS, INLINE_MAX_CHARS, INLINE_MIN_COLS, inlineClass, inlineDiagnostics, toneOf, truncateMessage } from "./inline-diagnostics.js";

const wide = { columns: 120, lineCount: 100, lineLength: () => 31 };

describe("toneOf", () => {
  it("is error for 1 and warning for 2, nothing for information or hints, and error for no severity (LSP's default)", () => {
    expect([1, 2, 3, 4, undefined].map(toneOf)).toEqual(["error", "warning", undefined, undefined, "error"]);
  });
});

describe("truncateMessage", () => {
  it("keeps a short message as it is, on one line", () => {
    expect(truncateMessage("Promise returned is not awaited", 80)).toBe("Promise returned is not awaited");
    expect(truncateMessage("  two\n lines  ", 80)).toBe("two");
    expect(truncateMessage("a   b\t c", 80)).toBe("a b c");
  });

  it("cuts a long one with an ellipsis, within the limit", () => {
    const cut = truncateMessage("Promise returned from cache.write is not awaited here", 20);
    // 19 columns of text fit; the last space is within 8 columns of the cut, so it ends there.
    expect(cut).toBe("Promise returned…");
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(truncateMessage("abc def ghi", 4)).toBe("abc…");
  });

  it("returns exactly the limit when it fits, and nothing for no room", () => {
    expect(truncateMessage("abcde", 5)).toBe("abcde");
    expect(truncateMessage("abcde", 0)).toBe("");
  });

  it("keeps markup as text: nothing is interpreted, nothing is escaped away", () => {
    expect(truncateMessage("<img src=x onerror=alert(1)>", 80)).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("inlineDiagnostics", () => {
  it("is one chip for the demo's line 46 warning, in the warning tone", () => {
    expect(inlineDiagnostics([{ line: 46, severity: 2, message: "Promise returned is not awaited" }], wide)).toEqual([
      { line: 46, tone: "warning", text: "Promise returned is not awaited", full: "Promise returned is not awaited" },
    ]);
  });

  it("shows one per line: an error over a warning, and the first of equals", () => {
    const got = inlineDiagnostics(
      [
        { line: 3, severity: 2, message: "first warning" },
        { line: 3, severity: 1, message: "an error" },
        { line: 3, severity: 1, message: "a later error" },
        { line: 5, severity: 2, message: "w1" },
        { line: 5, severity: 2, message: "w2" },
      ],
      wide,
    );
    expect(got.map((d) => [d.line, d.tone, d.text])).toEqual([
      [3, "error", "an error"],
      [5, "warning", "w1"],
    ]);
  });

  it("leaves out information and hints, blank messages and a line below 1", () => {
    expect(
      inlineDiagnostics(
        [
          { line: 1, severity: 3, message: "info" },
          { line: 2, severity: 4, message: "hint" },
          { line: 3, severity: 2, message: "  " },
          { line: 0, severity: 2, message: "off the file" },
        ],
        wide,
      ),
    ).toEqual([]);
  });

  it("cuts the message to the room the line has left, with the chip's chrome", () => {
    const layout = { columns: 60, lineCount: 100, lineLength: () => 31 };
    const [d] = inlineDiagnostics([{ line: 1, severity: 2, message: "Promise returned from cache.write is not awaited here" }], layout);
    // The cut may drop a trailing space before the ellipsis, so it is at most the room.
    expect(d!.text.length).toBeLessThanOrEqual(60 - 31 - INLINE_CHROME_COLS);
    expect(d!.text.length).toBeGreaterThan(60 - 31 - INLINE_CHROME_COLS - 3);
    expect(d!.text.endsWith("…")).toBe(true);
  });

  it("never shows more than the longest message", () => {
    const [d] = inlineDiagnostics([{ line: 1, severity: 1, message: "x".repeat(500) }], { columns: 1000, lineCount: 100, lineLength: () => 0 });
    expect(d!.text).toHaveLength(INLINE_MAX_CHARS);
  });

  it("gives a line with no room no chip, rather than wrapping the code below it", () => {
    const tight = { columns: 40, lineCount: 100, lineLength: () => 40 - INLINE_CHROME_COLS - INLINE_MIN_COLS + 1 };
    expect(inlineDiagnostics([{ line: 1, severity: 2, message: "message" }], tight)).toEqual([]);
    const just = { columns: 40, lineCount: 100, lineLength: () => 40 - INLINE_CHROME_COLS - INLINE_MIN_COLS };
    expect(inlineDiagnostics([{ line: 1, severity: 2, message: "message" }], just)).toHaveLength(1);
  });

  it("comes back in line order", () => {
    const got = inlineDiagnostics([{ line: 9, severity: 2, message: "b" }, { line: 2, severity: 2, message: "a" }], wide);
    expect(got.map((d) => d.line)).toEqual([2, 9]);
  });
});

describe("inlineClass", () => {
  it("is the shared class and the tone's", () => {
    expect(inlineClass("warning")).toBe("spexr-inline-diag spexr-inline-diag--warning");
    expect(inlineClass("error")).toBe("spexr-inline-diag spexr-inline-diag--error");
  });
});

describe("the marker-to-chip step on awkward input", () => {
  it("draws nothing for a marker past the end of the file, and the others still", () => {
    const got = inlineDiagnostics([{ line: 500, severity: 2, message: "stale" }, { line: 3, severity: 2, message: "here" }], { ...wide, lineCount: 10 });
    expect(got.map((d) => d.line)).toEqual([3]);
    expect(inlineDiagnostics([{ line: 11, severity: 2, message: "past" }], { ...wide, lineCount: 10 })).toEqual([]);
    expect(inlineDiagnostics([{ line: 10, severity: 2, message: "last line" }], { ...wide, lineCount: 10 })).toHaveLength(1);
  });

  it("treats a marker with no severity as an error, ranked with the errors", () => {
    const [d] = inlineDiagnostics([{ line: 1, severity: 2, message: "warn" }, { line: 1, severity: undefined, message: "unspecified" }], wide);
    expect(d).toMatchObject({ tone: "error", text: "unspecified" });
  });

  it("copes with many markers on many lines, one chip each, in order", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ line: 500 - i, severity: 2, message: `m${i}` }));
    const got = inlineDiagnostics(many, { columns: 120, lineCount: 500, lineLength: () => 10 });
    expect(got).toHaveLength(500);
    expect(got[0]!.line).toBe(1);
    expect(got[499]!.line).toBe(500);
  });

  it("trims before taking the first line, so a leading newline does not hide the message", () => {
    expect(truncateMessage("\n\n  the real message\nsecond", 80)).toBe("the real message");
  });

  it("counts a wide character (CJK, emoji) as two columns and never cuts inside a surrogate pair", () => {
    const text = "\u{1f600}".repeat(10); // 20 columns
    const cut = truncateMessage(text, 7); // room for 3 emoji (6 columns) and the ellipsis
    expect(cut).toBe("\u{1f600}".repeat(3) + "\u2026");
    expect(truncateMessage("Ünïcödé", 80)).toBe("Ünïcödé");
  });

  it("fits a CJK message to the columns it has: 20 columns hold 9 characters and the ellipsis", () => {
    const cjk = "日本語のメッセージが長すぎる場合は省略されます";
    const cut = truncateMessage(cjk, 20);
    expect(displayWidth(cut, 4)).toBeLessThanOrEqual(20);
    expect(Array.from(cut).length).toBe(10);
    expect(cut.endsWith("\u2026")).toBe(true);
    expect(truncateMessage("日本語", 6)).toBe("日本語");
    expect(truncateMessage("日本語", 5)).toBe("日本\u2026");
  });

  it("ends on a space when one lies within the last 8 columns, and mid-word when none does", () => {
    expect(truncateMessage("Promise returned from cache.write is not awaited", 24)).toBe("Promise returned from\u2026");
    expect(truncateMessage("Pneumonoultramicroscopicsilicovolcanoconiosis", 12)).toBe("Pneumonoult\u2026");
    expect(truncateMessage("aaaa bbbbbbbbbbbbbbbbbbbb", 16)).toBe("aaaa bbbbbbbbbb\u2026");
  });

  it("takes the zero-width characters, the marks and the line separators out", () => {
    expect(truncateMessage("a\u200bb\u200cc\u200dd\u2060e\ufefff", 80)).toBe("a b c d e f");
    expect(truncateMessage("x\u200ey\u200fz\u061cw", 80)).toBe("x y z w");
    expect(truncateMessage("one\u2028two\u2029three", 80)).toBe("one two three");
  });

  it("takes control characters and bidi overrides out of the chip", () => {
    expect(truncateMessage("a\u0007b\u202ec\u2066d\u2069e", 80)).toBe("a b c d e");
    expect(truncateMessage("x\u001b[31my", 80)).toBe("x [31my");
  });

  it("caps the hover's text at about 2000 characters", () => {
    const block = plainTextBlock("x".repeat(5000));
    expect(block.length).toBeLessThan(2100);
    expect(block.endsWith("\u2026\n```")).toBe(true);
    expect(plainTextBlock("y".repeat(2000))).not.toContain("\u2026");
  });

  it("keeps the whole message for the hover, and fences it so nothing in it ends the block", () => {
    const [d] = inlineDiagnostics([{ line: 1, severity: 2, message: "Promise returned from cache.write is not awaited here, at all" }], { columns: 40, lineCount: 5, lineLength: () => 5 });
    expect(d!.full).toBe("Promise returned from cache.write is not awaited here, at all");
    expect(plainTextBlock("a ``` b")).toBe("````text\na ``` b\n````");
    expect(plainTextBlock("plain")).toBe("```text\nplain\n```");
    expect(plainTextBlock("a\u202eb")).toBe("```text\nab\n```");
  });
});

describe("displayWidth", () => {
  it("expands a tab to the next stop, and counts wide characters twice", () => {
    expect(displayWidth("abc", 4)).toBe(3);
    expect(displayWidth("\tx", 4)).toBe(5);
    expect(displayWidth("ab\tx", 4)).toBe(5);
    expect(displayWidth("日本", 4)).toBe(4);
    expect(displayWidth("a\u{1f600}", 4)).toBe(3);
    expect(isWide("a".codePointAt(0)!)).toBe(false);
  });

  it("stops scanning at the cap: a line already as wide as the editor is not read to its end", () => {
    expect(displayWidth("x".repeat(100_000), 4, 120)).toBe(120);
    expect(displayWidth("abc", 4, 120)).toBe(3);
    expect(displayWidth("日".repeat(100), 4, 50)).toBe(50);
  });

  it("is what makes a line of tabs or CJK leave less room for the chip", () => {
    const layout = { columns: 60, lineCount: 5, lineLength: () => displayWidth("\t\t\tcode", 8) };
    const [d] = inlineDiagnostics([{ line: 1, severity: 2, message: "x".repeat(60) }], layout);
    expect(d!.text.length).toBeLessThan(60 - 4 - INLINE_CHROME_COLS);
  });
});
