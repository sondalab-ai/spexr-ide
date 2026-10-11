import { describe, expect, it } from "vitest";
import { isIdlePrompt, pasteInto, screenRows, stripAnsi } from "./pty-screen.js";

const IDLE = ["╭──────────────────────╮", "│ >                    │", "╰──────────────────────╯", "  ? for shortcuts"];
const DIALOG = ["Bash command", "  pnpm test", "Do you want to proceed?", "❯ 1. Yes", "  2. Yes, and don't ask again for this command", "  3. No, and tell Claude what to do differently (esc)"];

describe("stripAnsi / screenRows", () => {
  it("takes colour, cursor and title sequences out, and keeps the text", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m \x1b]0;title\x07ok\x1b[2K")).toContain("red");
    expect(stripAnsi("\x1b[31mred\x1b[0m")).not.toMatch(/\x1b|\[31m/);
    expect(stripAnsi("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("is the last non-blank rows, trimmed on the right", () => {
    expect(screenRows("one\n\ntwo   \n\n\nthree\n", 2)).toEqual(["two", "three"]);
  });
});

describe("isIdlePrompt", () => {
  it("is idle on an empty input box with its hint", () => {
    expect(isIdlePrompt(IDLE)).toBe(true);
  });

  it("is idle on the bare prompt of a newer layout, with text typed in it", () => {
    expect(isIdlePrompt(["────────", "❯ fix the build", "────────", "  ⏵⏵ accept edits on (shift+tab to cycle)"])).toBe(true);
  });

  it("fails closed on a permission dialog: numbered options, a question", () => {
    expect(isIdlePrompt(DIALOG)).toBe(false);
    expect(isIdlePrompt([...IDLE, ...DIALOG])).toBe(false);
  });

  it("fails closed on a confirm hint or a cancel hint, even beside a prompt", () => {
    expect(isIdlePrompt([...IDLE, "Enter to confirm · Esc to cancel"])).toBe(false);
    expect(isIdlePrompt(["│ >  │", "Press Enter to continue"])).toBe(false);
  });

  it("fails closed with no prompt on screen at all: a spinner, a blank screen, a form", () => {
    expect(isIdlePrompt([])).toBe(false);
    expect(isIdlePrompt(["✻ Thinking… (esc to interrupt)"])).toBe(false);
    expect(isIdlePrompt(["Name", "  [ field ]"])).toBe(false);
  });
});

describe("pasteInto", () => {
  const sleeper = async (): Promise<void> => undefined;

  it("pastes with explicit brackets, then presses Enter once, while the screen is idle before and after", async () => {
    const writes: string[] = [];
    expect(await pasteInto((d) => writes.push(d), "go\x1b[Z", sleeper, () => true)).toBe("submitted");
    expect(writes).toEqual(["\x1b[200~go[Z\x1b[201~", "\r"]);
  });

  it("writes nothing when the screen is not idle before the paste", async () => {
    const writes: string[] = [];
    expect(await pasteInto((d) => writes.push(d), "go", sleeper, () => false)).toBe("not-idle");
    expect(writes).toEqual([]);
  });

  it("leaves the text in the input, with no Enter, when a dialog appears after the paste", async () => {
    const writes: string[] = [];
    let calls = 0;
    expect(await pasteInto((d) => writes.push(d), "go", sleeper, () => ++calls === 1)).toBe("left-in-input");
    expect(writes).toEqual(["\x1b[200~go\x1b[201~"]);
  });
});
