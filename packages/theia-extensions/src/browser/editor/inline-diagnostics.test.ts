import { describe, expect, it } from "vitest";
import { INLINE_CHROME_COLS, INLINE_MAX_CHARS, INLINE_MIN_COLS, inlineClass, inlineDiagnostics, toneOf, truncateMessage } from "./inline-diagnostics.js";

const wide = { columns: 120, lineLength: () => 31 };

describe("toneOf", () => {
  it("is error for 1 and warning for 2, and nothing for information, hints or no severity", () => {
    expect([1, 2, 3, 4, undefined].map(toneOf)).toEqual(["error", "warning", undefined, undefined, undefined]);
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
    expect(cut).toBe("Promise returned fr…");
    expect(cut).toHaveLength(20);
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
      { line: 46, tone: "warning", text: "Promise returned is not awaited" },
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
          { line: 4, severity: undefined, message: "no severity" },
        ],
        wide,
      ),
    ).toEqual([]);
  });

  it("cuts the message to the room the line has left, with the chip's chrome", () => {
    const layout = { columns: 60, lineLength: () => 31 };
    const [d] = inlineDiagnostics([{ line: 1, severity: 2, message: "Promise returned from cache.write is not awaited here" }], layout);
    // The cut may drop a trailing space before the ellipsis, so it is at most the room.
    expect(d!.text.length).toBeLessThanOrEqual(60 - 31 - INLINE_CHROME_COLS);
    expect(d!.text.length).toBeGreaterThan(60 - 31 - INLINE_CHROME_COLS - 3);
    expect(d!.text.endsWith("…")).toBe(true);
  });

  it("never shows more than the longest message", () => {
    const [d] = inlineDiagnostics([{ line: 1, severity: 1, message: "x".repeat(500) }], { columns: 1000, lineLength: () => 0 });
    expect(d!.text).toHaveLength(INLINE_MAX_CHARS);
  });

  it("gives a line with no room no chip, rather than wrapping the code below it", () => {
    const tight = { columns: 40, lineLength: () => 40 - INLINE_CHROME_COLS - INLINE_MIN_COLS + 1 };
    expect(inlineDiagnostics([{ line: 1, severity: 2, message: "message" }], tight)).toEqual([]);
    const just = { columns: 40, lineLength: () => 40 - INLINE_CHROME_COLS - INLINE_MIN_COLS };
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
