import { describe, expect, it } from "vitest";
import type { Key, KeyCode } from "@theia/core/lib/browser/keyboard/keys";
import type { Keybinding } from "@theia/core/lib/common/keybinding";
import { boundKeyCaps, type KeyBindings } from "../views/key-caps.js";
import {
  agentsLabel,
  bellLabel,
  CRUMB_ELLIPSIS,
  fieldKeys,
  initials,
  QUICK_OPEN_COMMAND,
  runningAgents,
  titleCrumb,
} from "./titlebar-model.js";

describe("titleCrumb", () => {
  const ws = "/home/me/probe-engine";

  it("names the root, the active file's folders and the file", () => {
    expect(titleCrumb([ws], `${ws}/src/probe/resolve.ts`)).toEqual(["probe-engine", "src", "probe", "resolve.ts"]);
    expect(titleCrumb([ws], `${ws}/README.md`)).toEqual(["probe-engine", "README.md"]);
  });

  it("folds folders past the last two into an ellipsis", () => {
    expect(titleCrumb([ws], `${ws}/a/b/c/d.ts`)).toEqual(["probe-engine", CRUMB_ELLIPSIS, "b", "c", "d.ts"]);
  });

  it("is the first root alone with no active editor, and empty with no workspace", () => {
    expect(titleCrumb([ws, "/srv/other"])).toEqual(["probe-engine"]);
    expect(titleCrumb([`${ws}/`])).toEqual(["probe-engine"]);
    expect(titleCrumb([])).toEqual([]);
  });

  it("picks the deepest root holding the file in a multi-root workspace", () => {
    expect(titleCrumb([ws, `${ws}/packages/core`], `${ws}/packages/core/src/a.ts`)).toEqual(["core", "src", "a.ts"]);
  });

  it("never claims a root the file is not in, a sibling with the same prefix included", () => {
    expect(titleCrumb([ws], "/home/me/probe-engine-2/src/x.ts")).toEqual(["src", "x.ts"]);
    expect(titleCrumb([ws], "/Untitled-1")).toEqual(["Untitled-1"]);
  });
});

/** A registry with ctrlcmd+p on Quick Open, resolved as Theia resolves it on each platform. */
function registry(meta: boolean, bound = true): KeyBindings {
  const p: Key = { code: "KeyP", keyCode: 80, easyString: "p" };
  return {
    getKeybindingsForCommand: (id: string) => (bound && id === QUICK_OPEN_COMMAND ? [{ command: id, keybinding: "ctrlcmd+p" } as Keybinding] : []),
    resolveKeybinding: () => [{ key: p, ctrl: !meta, shift: false, alt: false, meta } as KeyCode],
    acceleratorForKey: (key: Key) => (key.code === "KeyP" ? "P" : key.code),
  };
}

describe("fieldKeys", () => {
  it("shows Quick Open's real keys: ⌘ P on macOS, Ctrl P elsewhere, and names them for ARIA", () => {
    expect(fieldKeys(boundKeyCaps(registry(true), QUICK_OPEN_COMMAND, "mac"))).toEqual({ caps: ["⌘", "P"], aria: "Meta+P" });
    expect(fieldKeys(boundKeyCaps(registry(false), QUICK_OPEN_COMMAND, "linux"))).toEqual({ caps: ["Ctrl", "P"], aria: "Control+P" });
    expect(fieldKeys(boundKeyCaps(registry(false), QUICK_OPEN_COMMAND, "windows"))).toEqual({ caps: ["Ctrl", "P"], aria: "Control+P" });
  });

  it("shows no keys once the user unbinds Quick Open", () => {
    expect(fieldKeys(boundKeyCaps(registry(false, false), QUICK_OPEN_COMMAND, "linux"))).toBeUndefined();
  });

  it("flattens a chord sequence and names none, which ARIA cannot express", () => {
    expect(fieldKeys({ chords: [["Ctrl", "K"], ["Ctrl", "P"]] })).toEqual({ caps: ["Ctrl", "K", "Ctrl", "P"] });
  });
});

describe("the agents badge", () => {
  it("counts the working sessions only", () => {
    expect(runningAgents([{ state: "working" }, { state: "idle" }, { state: "working" }, { state: "done" }])).toBe(2);
    expect(runningAgents([])).toBe(0);
  });

  it("is hidden at 0 and says the count in words otherwise", () => {
    expect(agentsLabel(0)).toBeUndefined();
    expect(agentsLabel(1)).toBe("1 agent running");
    expect(agentsLabel(2)).toBe("2 agents running");
  });
});

describe("bellLabel", () => {
  it("says the unread count in the name, which forced colours keep when they drop the dot", () => {
    expect(bellLabel(0)).toBe("Notifications");
    expect(bellLabel(3)).toBe("Notifications, 3 unread");
  });
});

describe("initials", () => {
  it("takes the first and last words' first letters", () => {
    expect(initials("Marcello Barile")).toBe("MB");
    expect(initials("  ada  king lovelace ")).toBe("AL");
  });

  it("takes two letters of a single word, skipping punctuation", () => {
    expect(initials("marcello")).toBe("MA");
    expect(initials("@m")).toBe("M");
  });

  it("reads letters beyond ASCII", () => {
    expect(initials("Élodie Ünal")).toBe("ÉÜ");
  });

  it("is undefined without a name, so the avatar falls back to the account glyph", () => {
    expect(initials(undefined)).toBeUndefined();
    expect(initials("   ")).toBeUndefined();
    expect(initials("--")).toBeUndefined();
  });
});
