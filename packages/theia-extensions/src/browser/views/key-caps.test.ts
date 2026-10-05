import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Key, KeyCode } from "@theia/core/lib/browser/keyboard/keys";
import type { Keybinding } from "@theia/core/lib/common/keybinding";
import { ariaKey, boundKeyCaps, keyCaps, keyPlatform, type KeyBindings, type KeyChord } from "./key-caps.js";

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
  it("names named keys by their code, and every other key by the character it prints", () => {
    expect(ariaKey("KeyA", "A")).toBe("A");
    expect(ariaKey("Digit7", "7")).toBe("7");
    expect(ariaKey("ArrowUp", "↑")).toBe("ArrowUp");
    expect(ariaKey("F12", "F12")).toBe("F12");
    expect(ariaKey("Enter", "⏎")).toBe("Enter");
    expect(ariaKey("Slash", "/")).toBe("/");
    expect(ariaKey("Backquote", "`")).toBe("`");
  });

  // On AZERTY the key that prints "a" is the physical KeyQ.
  it("follows the layout, not the physical key", () => {
    expect(ariaKey("KeyQ", "A")).toBe("A");
    expect(ariaKey("KeyQ", "a")).toBe("A");
  });
});

describe("keyPlatform", () => {
  it("is mac on macOS, windows on Windows, linux otherwise", () => {
    expect(keyPlatform(true, false)).toBe("mac");
    expect(keyPlatform(false, true)).toBe("windows");
    expect(keyPlatform(false, false)).toBe("linux");
  });
});

// A stand-in for Theia's KeybindingRegistry on an AZERTY layout: the binding
// says "a", which the layout service resolves to the physical KeyQ, whose
// character is "a". Parsing the binding raw would give KeyA, which prints "Q".
describe("boundKeyCaps", () => {
  const key = (code: string): Key => ({ code, keyCode: 0, easyString: code }) as unknown as Key;
  const AZERTY: Record<string, string> = { KeyQ: "A", KeyA: "Q", KeyS: "S" };
  const chord = (code: string): KeyCode => ({ ctrl: false, shift: true, alt: false, meta: true, key: key(code) }) as unknown as KeyCode;
  const registry = (bindings: Keybinding[], resolved: Record<string, KeyCode[]>): KeyBindings => ({
    getKeybindingsForCommand: () => bindings,
    resolveKeybinding: (binding) => resolved[binding.keybinding] ?? [],
    acceleratorForKey: (k) => AZERTY[k.code] ?? k.code,
  });
  const binding = (keybinding: string): Keybinding => ({ command: "spexr.claude.focus", keybinding });

  it("shows the key the layout resolves, and names it the same way", () => {
    const caps = boundKeyCaps(registry([binding("ctrlcmd+shift+a")], { "ctrlcmd+shift+a": [chord("KeyQ")] }), "spexr.claude.focus", "mac");
    expect(caps).toEqual({ chords: [["⇧", "⌘", "A"]], aria: "Shift+Meta+A" });
  });

  it("takes the first binding, as a menu shows it", () => {
    const caps = boundKeyCaps(
      registry([binding("ctrlcmd+shift+a"), binding("ctrlcmd+shift+s")], { "ctrlcmd+shift+a": [chord("KeyQ")], "ctrlcmd+shift+s": [chord("KeyS")] }),
      "spexr.claude.focus",
      "windows",
    );
    expect(caps?.chords).toEqual([["Shift", "Windows", "A"]]);
  });

  it("is undefined when nothing is bound", () => {
    expect(boundKeyCaps(registry([], {}), "spexr.claude.focus", "mac")).toBeUndefined();
  });
});

// The welcome widget wires the registry in: no DOM here, so its source is read.
describe("the welcome widget", () => {
  const widget = readFileSync(fileURLToPath(new URL("./welcome-widget.tsx", import.meta.url)), "utf8");

  it("shows the agent command's keys for this platform", () => {
    expect(widget).toContain("agentShortcut={boundKeyCaps(this.keybindings, AGENT_FOCUS_COMMAND, keyPlatform(isOSX, isWindows))}");
    expect(widget).toContain('const AGENT_FOCUS_COMMAND = "spexr.claude.focus";');
  });

  it("renders again when the bindings change", () => {
    expect(widget).toContain("this.toDispose.push(this.keybindings.onKeybindingsChanged(() => this.update()));");
  });
});
