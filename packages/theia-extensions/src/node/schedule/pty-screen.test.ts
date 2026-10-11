import { afterEach, describe, expect, it } from "vitest";
import { PtyScreen, isIdleScreen, pasteInto, type ScreenSnapshot } from "./pty-screen.js";

const ESC = "\x1b";
const sgr = (code: string, s: string, reset = "0"): string => `${ESC}[${code}m${s}${ESC}[${reset}m`;
/** 1-based cursor position. */
const at = (row: number, col: number): string => `${ESC}[${row};${col}H`;
const EL = `${ESC}[K`;
const SAVE = `${ESC}7`;
const RESTORE = `${ESC}8`;
const RULE = "─".repeat(120);

/** The idle layout of Claude Code 2.1.296 in a 40-row screen: rule, `❯` input, rule, two footer rows, drawn by cursor addressing with colour; the cursor parked in the input. */
function idleFrame(input = ""): string {
  return (
    at(36, 1) + sgr("2", RULE, "22") + EL +
    at(37, 1) + sgr("38;5;246", "❯", "39") + " " + input + EL +
    at(38, 1) + sgr("2", RULE, "22") + EL +
    at(39, 3) + sgr("2", "main ●16 Opus 5.5", "22") + EL +
    at(40, 3) + sgr("38;5;141", "⏵⏵ accept edits on", "39") + sgr("2", " (shift+tab to cycle)", "22") + EL +
    at(37, 3 + input.length)
  );
}

/** A permission dialog drawn above the stale frame, coloured as the CLI does, ending with the cursor on the selected option. */
const permissionDialog =
  at(28, 1) + sgr("1", "Bash command", "22") + EL +
  at(29, 3) + "pnpm test" + EL +
  at(31, 1) + "Do you want to proceed?" + EL +
  at(32, 3) + sgr("36", "❯") + " " + sgr("36", "1.") + " Yes" + EL +
  at(33, 5) + "2. Yes, and don't ask again for this command" + EL +
  at(34, 5) + "3. No, and tell Claude what to do differently (esc)" + EL +
  at(32, 3);

/** The same dialog once it has also erased the frame's rows below it. */
const dialogOverFrame = permissionDialog.slice(0, -at(32, 3).length) + at(35, 1) + `${ESC}[J` + at(32, 3);

/** The review's probe (D): an MCP elicitation form drawn above the stale prompt; the cursor ends in the form's field. */
const elicitationForm =
  at(30, 1) + "MCP server github requests input" + EL +
  at(32, 1) + "Repository name" + EL +
  at(33, 1) + sgr("36", ">", "39") + " " + EL +
  at(35, 1) + sgr("2", "Enter to submit · Tab next field", "22") + EL;

/** The review's probe (E): an AskUserQuestion-style list above the stale prompt; the cursor ends on the last option. */
const questionList =
  at(30, 1) + "Which database should we use?" + EL +
  at(31, 1) + sgr("36", "❯", "39") + " Postgres" + EL +
  at(32, 3) + "SQLite" + EL +
  at(33, 3) + "Type something." + EL;

/** A footer timer tick as the CLI redraws it: save the cursor, address the footer, erase, restore. */
const tick = (n: number): string => SAVE + at(39, 60) + sgr("2", `◐ 1 background task · ${n}s`, "22") + EL + RESTORE;
/** A tick that restores the cursor by addressing it, as a redraw that ends on the prompt does. */
const tickBackToInput = (n: number): string => at(39, 60) + sgr("2", `◐ ${n}s`, "22") + EL + at(37, 3);

const screens: PtyScreen[] = [];
async function feed(chunks: string[], cols = 120, rows = 40): Promise<PtyScreen> {
  const s = new PtyScreen(cols, rows);
  screens.push(s);
  for (const c of chunks) s.write(c);
  return s;
}
afterEach(() => {
  for (const s of screens.splice(0)) s.dispose();
});

describe("isIdleScreen, on rows", () => {
  const snap = (rows: string[], cursorRow: number): ScreenSnapshot => ({ rows, cursorRow });
  it("needs the rule, the input, the rule and the cursor in the input, whatever the rows above", () => {
    const rows = ["history", "", RULE, "❯ fix the build", RULE, "  ⏸ plan mode on (shift+tab to cycle)"];
    expect(isIdleScreen(snap(rows, 3))).toBe(true);
    expect(isIdleScreen(snap(rows, 5))).toBe(false);
    expect(isIdleScreen(snap(rows, 0))).toBe(false);
  });

  it("fails closed on a layout it does not know: the boxed prompt, a different rule glyph, no rule", () => {
    expect(isIdleScreen(snap(["╭──────────────────────╮", "│ >                    │", "╰──────────────────────╯", "  ? for shortcuts"], 1))).toBe(false);
    expect(isIdleScreen(snap([RULE.replace(/─/g, "━"), "❯ ", RULE.replace(/─/g, "━")], 1))).toBe(false);
    expect(isIdleScreen(snap(["❯ ", "  ? for shortcuts"], 0))).toBe(false);
    expect(isIdleScreen(snap([], 0))).toBe(false);
    expect(isIdleScreen(snap(["", "", ""], 0))).toBe(false);
  });

  it("accepts a multi-line input with the cursor on any of its rows, and an empty footer", () => {
    const rows = [RULE, "❯ first line", "  second line", RULE];
    expect(isIdleScreen(snap(rows, 2))).toBe(true);
    expect(isIdleScreen(snap(rows, 3))).toBe(false);
  });

  it("rejects a second prompt-like row under the input, and a numbered option as the input", () => {
    expect(isIdleScreen(snap([RULE, "❯ a", "❯ b", RULE], 1))).toBe(false);
    expect(isIdleScreen(snap([RULE, "❯ 1. Yes", RULE], 1))).toBe(false);
  });

  it("vetoes dialog chrome just above the input or in the footer, even with the layout and the cursor right", () => {
    for (const chrome of ["Enter to submit", "↑↓ to navigate", "Enter to select", "Type something.", "Esc to cancel", "Do you want to proceed?", "Press Enter to continue"]) {
      expect(isIdleScreen(snap([chrome, RULE, "❯ ", RULE, "  ⏸ plan mode on"], 2)), chrome).toBe(false);
      expect(isIdleScreen(snap([RULE, "❯ ", RULE, chrome], 1)), chrome).toBe(false);
    }
  });

  it("does not veto on the follow-up text sitting in the input, nor on an old message far above", () => {
    const old = ["Do you want to proceed?", "", "", "", "", "", "", "", RULE, "❯ Do you want to retry? Press Enter", RULE, "  ⏸ plan mode on"];
    expect(isIdleScreen(snap(old, 9))).toBe(true);
  });
});

/** Screens captured from the real `claude` 2.1.296 in a 120x40 pty (node-pty and @xterm/headless, 2026-10-11), trimmed to the rows that matter. */
describe("isIdleScreen, on screens captured from the real CLI", () => {
  const rule = "─".repeat(120);
  const snap = (rows: string[], cursorRow: number): ScreenSnapshot => ({ rows, cursorRow });

  it("is idle on the empty prompt with its placeholder, in each permission mode's footer", () => {
    for (const mode of ["⏵⏵ auto mode on (shift+tab to cycle) · ← 3 agents", "⏸ manual mode on · ← 3 agents", "⏵⏵ accept edits on (shift+tab to cycle)", "⏸ plan mode on (shift+tab to cycle)"]) {
      const rows = [...Array(34).fill(""), "● high · /effort".padStart(120), rule, '❯ Try "how do I log an error?"', rule, "  🌿 main ●16 ↓19  🤖 Opus 5.5  📊 2.4M out", `  ${mode}`];
      expect(isIdleScreen(snap(rows, 36)), mode).toBe(true);
    }
  });

  it("is idle after a long paste: the CLI folds it into a `[Pasted text #N +K lines]` token, whatever its length", () => {
    const folded = [...Array(33).fill(""), "Ctrl+Y to paste deleted text".padStart(120), rule, "❯ line 1 of the follow-up[Pasted text #2 +39 lines]", rule, "  🌿 main ●16 ↓19  🤖 Opus 5.5", "  paste again to expand"];
    expect(isIdleScreen(snap(folded, 35))).toBe(true);
    const inline = [...Array(31).fill(""), rule, "❯ line 1 of the follow-up", "  line 2 of the follow-up", "  line 3 of the follow-up", rule, "  🌿 main ●16 ↓19", "  ⏵⏵ auto mode on (shift+tab to cycle)"];
    expect(isIdleScreen(snap(inline, 34))).toBe(true);
  });

  it("is not idle on the /model dialog, with its `❯ 2.` option and Esc hint", () => {
    const rows = [...Array(18).fill(""), "▔".repeat(120), "   Select model", "", "     1.  Default (recommended)  Opus 5.5", "   ❯ 2.  Opus 5.5 ✔             For complex work", "     3.  Fable 5.1              For your toughest challenges", ...Array(12).fill(""), "   Enter to set as default · s to use this session only · Esc to cancel"];
    expect(isIdleScreen(snap(rows, 22))).toBe(false);
  });

  it("is not idle on the folder-trust dialog, drawn in the normal screen", () => {
    const rows = [rule, " Accessing workspace:", "", " /tmp/project", "", " Quick safety check: Is this a project you trust?", "", " Security guide", "", " ❯ No, exit", "   Yes, I trust this folder", "", " Enter to confirm · Esc to cancel"];
    expect(isIdleScreen(snap(rows, 9))).toBe(false);
  });

  it("is idle, a known limit, while the slash-command suggestions are listed over the input", () => {
    const rows = ["  ❯ /model         Set the AI model", "    /code-review   Review the current diff", rule, "❯ /model", rule, "  ⏸ plan mode on (shift+tab to cycle)"];
    expect(isIdleScreen(snap(rows, 3))).toBe(true);
  });
});

describe("PtyScreen, fed byte streams", () => {
  it("is idle on the idle frame, coloured and cursor-addressed, empty or with text typed in", async () => {
    expect(await (await feed([idleFrame()])).isIdle()).toBe(true);
    expect(await (await feed([idleFrame("fix the build")])).isIdle()).toBe(true);
  });

  it("is idle on the idle frame in the alternate screen, drawn after a clear, in split chunks", async () => {
    const frame = `${ESC}[?1049h${ESC}[2J${ESC}[H` + idleFrame("go");
    const cut = Math.floor(frame.length / 2) + 1;
    expect(await (await feed([frame.slice(0, cut), frame.slice(cut)])).isIdle()).toBe(true);
  });

  it("is not idle on a permission dialog, though its coloured `❯ 1. Yes` splits into fragments in a stripped stream", async () => {
    expect(await (await feed([idleFrame(), permissionDialog])).isIdle()).toBe(false);
  });

  it("is not idle on a dialog that has erased the frame below it, or only its input row", async () => {
    expect(await (await feed([idleFrame(), dialogOverFrame])).isIdle()).toBe(false);
    expect(await (await feed([idleFrame(), at(37, 1) + EL, permissionDialog])).isIdle()).toBe(false);
  });

  it("(D) is not idle on an MCP elicitation form above a stale prompt", async () => {
    expect(await (await feed([idleFrame(), elicitationForm])).isIdle()).toBe(false);
  });

  it("(E) is not idle on a question list above a stale prompt", async () => {
    expect(await (await feed([idleFrame(), questionList])).isIdle()).toBe(false);
  });

  it("(D) and (E) stay not idle even when the cursor is put back on the stale prompt: the chrome veto holds on its own", async () => {
    const park = at(37, 3);
    expect(await (await feed([idleFrame(), elicitationForm, park])).isIdle()).toBe(false);
    expect(await (await feed([idleFrame(), questionList, park])).isIdle()).toBe(false);
  });

  it("is not idle on a form with none of the known phrases above a stale prompt: the cursor in the form is enough", async () => {
    const unknownForm = at(30, 1) + "Choose a region" + EL + at(31, 1) + sgr("36", "❯", "39") + " eu-west" + EL + at(32, 3) + "us-east" + EL + at(32, 3);
    expect(await (await feed([idleFrame(), unknownForm])).isIdle()).toBe(false);
    expect(await (await feed([idleFrame(), unknownForm, at(37, 3)])).isIdle()).toBe(true);
  });

  it("stays idle while the footer is redrawn by timer ticks, with the cursor saved and restored or addressed back", async () => {
    expect(await (await feed([idleFrame(), tick(1), tick(2), tick(3)])).isIdle()).toBe(true);
    expect(await (await feed([idleFrame(), tickBackToInput(1), tickBackToInput(2)])).isIdle()).toBe(true);
  });

  it("stays not idle on a dialog that footer-timer redraws follow", async () => {
    expect(await (await feed([idleFrame(), permissionDialog, tick(1), tick(2), tick(3), tick(4)])).isIdle()).toBe(false);
    expect(await (await feed([idleFrame(), elicitationForm, tick(1), tick(2)])).isIdle()).toBe(false);
  });

  it("is not idle when the cursor is off the prompt row: in the footer, on the rule, or above", async () => {
    for (const row of [40, 38, 36, 20, 1]) expect(await (await feed([idleFrame(), at(row, 1)])).isIdle(), `row ${row}`).toBe(false);
    expect(await (await feed([idleFrame(), at(37, 1)])).isIdle()).toBe(true);
  });

  it("is not idle on a spinner with no input, or a blank screen; a cut escape sequence at the end changes nothing", async () => {
    expect(await (await feed([])).isIdle()).toBe(false);
    expect(await (await feed([at(10, 1) + "✻ Thinking… (esc to interrupt)"])).isIdle()).toBe(false);
    expect(await (await feed([idleFrame(), `${ESC}[3`])).isIdle()).toBe(true);
  });

  it("is not idle once the old inline layout comes back: boxed prompt, no rules", async () => {
    const boxed = at(36, 1) + "╭" + "─".repeat(20) + "╮" + at(37, 1) + "│ >" + " ".repeat(18) + "│" + at(38, 1) + "╰" + "─".repeat(20) + "╯" + at(37, 5);
    expect(await (await feed([boxed])).isIdle()).toBe(false);
  });

  it("follows a resize mid-stream: the emulator takes the new size, and the redrawn frame is read at the new bottom", async () => {
    const s = await feed([idleFrame("go")]);
    expect(s.size).toEqual({ cols: 120, rows: 40 });
    s.resize(100, 30);
    expect(s.size).toEqual({ cols: 100, rows: 30 });
    const redraw =
      `${ESC}[2J` +
      at(26, 1) + RULE.slice(0, 100) + at(27, 1) + "❯ go" + at(28, 1) + RULE.slice(0, 100) + at(29, 3) + "⏸ plan mode on" + at(30, 3) + "· 1 task" + at(27, 5);
    s.write(redraw);
    const snap = (await s.snapshot())!;
    expect(snap.rows).toHaveLength(30);
    expect(await s.isIdle()).toBe(true);
    s.write(at(24, 1) + "Do you want to proceed?" + at(24, 3));
    expect(await s.isIdle()).toBe(false);
  });

  it("ignores sizes that are not numbers, and says nothing once disposed", async () => {
    const s = await feed([idleFrame()]);
    s.resize(Number.NaN, 30);
    expect(s.size).toEqual({ cols: 120, rows: 40 });
    s.dispose();
    s.write("x");
    expect(await s.snapshot()).toBeUndefined();
    expect(await s.isIdle()).toBe(false);
  });
});

describe("pasteInto", () => {
  const sleeper = async (): Promise<void> => undefined;
  const yes = async (): Promise<boolean> => true;
  const no = async (): Promise<boolean> => false;

  it("pastes with explicit brackets, then presses Enter once, while the screen is idle before and after", async () => {
    const writes: string[] = [];
    expect(await pasteInto((d) => writes.push(d), "go\x1b[Z", sleeper, yes)).toBe("submitted");
    expect(writes).toEqual(["\x1b[200~go[Z\x1b[201~", "\r"]);
  });

  it("writes nothing when the screen is not idle before the paste", async () => {
    const writes: string[] = [];
    expect(await pasteInto((d) => writes.push(d), "go", sleeper, no)).toBe("not-idle");
    expect(writes).toEqual([]);
  });

  it("leaves the text in the input, with no Enter, when a dialog appears after the paste", async () => {
    const writes: string[] = [];
    let calls = 0;
    expect(await pasteInto((d) => writes.push(d), "go", sleeper, async () => ++calls === 1)).toBe("left-in-input");
    expect(writes).toEqual(["\x1b[200~go\x1b[201~"]);
  });

  it("reads the screen again after the wait, not before it", async () => {
    const order: string[] = [];
    await pasteInto((d) => order.push(d === "\r" ? "enter" : "paste"), "go", async () => void order.push("wait"), async () => (order.push("check"), true));
    expect(order).toEqual(["check", "paste", "wait", "check", "enter"]);
  });

  it("gates the Enter on a real screen: a dialog that opens during the wait stops it", async () => {
    const s = await feed([idleFrame()]);
    const writes: string[] = [];
    const outcome = await pasteInto(
      (d) => writes.push(d),
      "go",
      async () => s.write(permissionDialog),
      () => s.isIdle(),
    );
    expect(outcome).toBe("left-in-input");
    expect(writes).toHaveLength(1);
  });
});
