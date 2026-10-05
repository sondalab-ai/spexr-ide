import { describe, expect, it } from "vitest";
import { ariaKey, keyCaps, type KeyChord } from "./key-caps.js";

const chord = (key: Partial<KeyChord> & Pick<KeyChord, "label" | "code">): KeyChord => ({
  ctrl: false,
  shift: false,
  alt: false,
  meta: false,
  ...key,
});

describe("keyCaps", () => {
  // ctrlcmd+shift+a: Meta on macOS, Control elsewhere (Theia's KeySequence).
  it("gives one cap per key in the palette's order, with its ARIA name", () => {
    expect(keyCaps([chord({ meta: true, shift: true, label: "A", code: "KeyA" })], "mac")).toEqual({
      chords: [["⇧", "⌘", "A"]],
      aria: "Shift+Meta+A",
    });
    expect(keyCaps([chord({ ctrl: true, shift: true, label: "A", code: "KeyA" })], "windows")).toEqual({
      chords: [["Ctrl", "Shift", "A"]],
      aria: "Control+Shift+A",
    });
  });

  it("orders the modifiers Ctrl, Shift, Alt, Meta, as Monaco does", () => {
    const all = chord({ ctrl: true, shift: true, alt: true, meta: true, label: "K", code: "KeyK" });
    expect(keyCaps([all], "mac")?.chords).toEqual([["⌃", "⇧", "⌥", "⌘", "K"]]);
    expect(keyCaps([all], "linux")?.chords).toEqual([["Ctrl", "Shift", "Alt", "Super", "K"]]);
  });

  it("names no ARIA shortcut for a sequence of chords, which ARIA cannot express", () => {
    const caps = keyCaps([chord({ ctrl: true, label: "K", code: "KeyK" }), chord({ ctrl: true, label: "S", code: "KeyS" })], "linux");
    expect(caps).toEqual({ chords: [["Ctrl", "K"], ["Ctrl", "S"]] });
    expect(caps && "aria" in caps).toBe(false);
  });

  it("is undefined without a binding", () => {
    expect(keyCaps([], "mac")).toBeUndefined();
  });
});

describe("ariaKey", () => {
  it("names letters, digits and named keys as KeyboardEvent does, and punctuation by its character", () => {
    expect(ariaKey("KeyA", "A")).toBe("A");
    expect(ariaKey("Digit7", "7")).toBe("7");
    expect(ariaKey("ArrowUp", "↑")).toBe("ArrowUp");
    expect(ariaKey("F12", "F12")).toBe("F12");
    expect(ariaKey("Enter", "⏎")).toBe("Enter");
    expect(ariaKey("Slash", "/")).toBe("/");
    expect(ariaKey("Backquote", "`")).toBe("`");
  });
});
