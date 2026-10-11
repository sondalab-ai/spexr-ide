import { describe, expect, it } from "vitest";
import { PASTE_END, PASTE_START, bracketedPaste, sanitizePaste } from "./terminal-paste.js";

describe("sanitizePaste", () => {
  it("normalises line endings and keeps newlines and tabs", () => {
    expect(sanitizePaste("a\r\nb\rc\td")).toBe("a\nb\nc\td");
  });

  it("drops every control character: ESC (so a Shift+Tab or a paste end cannot be smuggled), C0, DEL and C1", () => {
    expect(sanitizePaste("hi\x1b[201~there")).toBe("hi[201~there");
    expect(sanitizePaste("x\x1b[Zy")).toBe("x[Zy");
    expect(sanitizePaste("a\x00b\x07c\x7fd\x9be\x9f")).toBe("abcde");
  });

  it("leaves ordinary and non-latin text alone", () => {
    expect(sanitizePaste("Also fix the colour literal, è 日本 \u{1f600}")).toBe("Also fix the colour literal, è 日本 \u{1f600}");
  });
});

describe("bracketedPaste", () => {
  it("wraps the text in explicit markers, and writes nothing after them", () => {
    expect(bracketedPaste("fix it\nthen test")).toBe("\x1b[200~fix it\nthen test\x1b[201~");
  });

  it("holds exactly one start and one end however hostile the text is, and no Enter or Shift+Tab", () => {
    const out = bracketedPaste("a\x1b[201~\r\x1b[Zb\x9b201~\rc");
    expect(out.split(PASTE_START)).toHaveLength(2);
    expect(out.split(PASTE_END)).toHaveLength(2);
    expect(out.startsWith(PASTE_START)).toBe(true);
    expect(out.endsWith(PASTE_END)).toBe(true);
    const inner = out.slice(PASTE_START.length, out.length - PASTE_END.length);
    expect(inner).not.toMatch(/\x1b|\x9b/);
    expect(inner.includes("\r")).toBe(false);
  });
});
