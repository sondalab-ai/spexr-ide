import type { Keybinding } from "@theia/core/lib/common/keybinding";
import type { Key, KeyCode } from "@theia/core/lib/browser/keyboard/keys";

/** One chord of a key binding: the modifiers it holds and its key. */
export interface KeyChord {
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  /** The key as the platform shows it (Theia's acceleratorForKey): "A", "↑", "F1". */
  readonly label: string;
  /** The key's KeyboardEvent code (Theia's Key.code): "KeyA", "ArrowUp", "Slash". */
  readonly code: string;
}

/** A binding as keycaps: one cap per key, chord by chord, and its ARIA name. */
export interface KeyCaps {
  readonly chords: readonly (readonly string[])[];
  /** aria-keyshortcuts; absent for a sequence of chords, which ARIA cannot express. */
  readonly aria?: string;
}

export type KeyPlatform = "mac" | "windows" | "linux";

/** Monaco's modifier labels (vs/base/common/keybindingLabels), as the palette's caps show them. */
const MODIFIER_LABELS: Record<KeyPlatform, { ctrl: string; shift: string; alt: string; meta: string }> = {
  mac: { ctrl: "⌃", shift: "⇧", alt: "⌥", meta: "⌘" },
  windows: { ctrl: "Ctrl", shift: "Shift", alt: "Alt", meta: "Windows" },
  linux: { ctrl: "Ctrl", shift: "Shift", alt: "Alt", meta: "Super" },
};

/** The modifiers a chord holds, in Monaco's order: Ctrl, Shift, Alt, Meta. */
function modifiers(chord: KeyChord): Array<"ctrl" | "shift" | "alt" | "meta"> {
  return (["ctrl", "shift", "alt", "meta"] as const).filter((m) => chord[m]);
}

const ARIA_MODIFIERS = { ctrl: "Control", shift: "Shift", alt: "Alt", meta: "Meta" } as const;

/**
 * A key's name in aria-keyshortcuts: a named key (Enter, ArrowUp, F1, Space)
 * by its code, which is its KeyboardEvent key, and any other key by the
 * character it prints on the user's layout (its label), a letter in capitals.
 * Never the code of a printing key: on AZERTY the "A" key is KeyQ.
 */
export function ariaKey(code: string, label: string): string {
  if (/^(?:F\d{1,2}|Enter|Escape|Tab|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right))$/.test(code)) {
    return code;
  }
  return label.length === 1 ? label.toUpperCase() : label;
}

/**
 * A key binding as keycaps, one cap per key in the order and with the labels
 * Monaco's palette uses, so a shortcut reads the same on a card as in the
 * command palette. Its aria-keyshortcuts names a single chord; a sequence of
 * chords has none. Undefined when there is no binding.
 */
export function keyCaps(chords: readonly KeyChord[], platform: KeyPlatform): KeyCaps | undefined {
  if (chords.length === 0) return undefined;
  const labels = MODIFIER_LABELS[platform];
  const caps = chords.map((chord) => [...modifiers(chord).map((m) => labels[m]), chord.label]);
  const only = chords.length === 1 ? chords[0]! : undefined;
  if (!only) return { chords: caps };
  return { chords: caps, aria: [...modifiers(only).map((m) => ARIA_MODIFIERS[m]), ariaKey(only.code, only.label)].join("+") };
}

/** The platform's modifier labels: macOS, Windows, or anything else (Linux). */
export function keyPlatform(osx: boolean, windows: boolean): KeyPlatform {
  return osx ? "mac" : windows ? "windows" : "linux";
}

/** What boundKeyCaps reads off Theia's KeybindingRegistry. */
export interface KeyBindings {
  getKeybindingsForCommand(commandId: string): readonly Keybinding[];
  resolveKeybinding(binding: Keybinding): readonly KeyCode[];
  acceleratorForKey(key: Key): string;
}

/**
 * The keys bound to a command, as keycaps: its first binding, as a menu shows
 * it, resolved for the user's keyboard layout (Theia's resolveKeybinding, as
 * its menus do), so a non-US layout shows the letter it prints and the ARIA
 * name agrees with the caps. Undefined when nothing is bound.
 */
export function boundKeyCaps(keybindings: KeyBindings, commandId: string, platform: KeyPlatform): KeyCaps | undefined {
  const binding = keybindings.getKeybindingsForCommand(commandId)[0];
  if (!binding) return undefined;
  const chords = keybindings.resolveKeybinding(binding).map((code) => ({
    ctrl: code.ctrl,
    shift: code.shift,
    alt: code.alt,
    meta: code.meta,
    label: code.key ? keybindings.acceleratorForKey(code.key) : "",
    code: code.key?.code ?? "",
  }));
  return keyCaps(chords, platform);
}
