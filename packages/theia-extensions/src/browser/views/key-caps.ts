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
 * A key's name in aria-keyshortcuts: a letter or a digit as itself, a named
 * key (Enter, ArrowUp, F1) by its code, which is its KeyboardEvent key, and
 * any other key (punctuation) by the character it prints.
 */
export function ariaKey(code: string, label: string): string {
  const letterOrDigit = /^(?:Key([A-Z])|Digit(\d))$/.exec(code);
  if (letterOrDigit) return letterOrDigit[1] ?? letterOrDigit[2]!;
  if (/^(?:F\d{1,2}|Enter|Escape|Tab|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right))$/.test(code)) {
    return code;
  }
  return label;
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
