import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AGENT_LOG_VIEW_ID, OUTPUT_VIEW_ID, PROBLEMS_VIEW_ID, bottomOrder, isNumberedTerminalTitle, nextTerminalTitle, problemSeverity } from "./bottom-panel.js";

const own = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

describe("a shell terminal's title (S6e, B2)", () => {
  it("is Terminal, then Terminal 2, 3, ...", () => {
    expect(nextTerminalTitle([])).toBe("Terminal");
    expect(nextTerminalTitle(["Terminal"])).toBe("Terminal 2");
    expect(nextTerminalTitle(["Terminal", "Terminal 2"])).toBe("Terminal 3");
  });

  it("gives a closed terminal's number again, lowest first", () => {
    expect(nextTerminalTitle(["Terminal", "Terminal 3"])).toBe("Terminal 2");
    expect(nextTerminalTitle(["Terminal 2"])).toBe("Terminal");
  });

  it("is not confused by names that only look alike", () => {
    expect(nextTerminalTitle(["bash", "Terminal 1", "terminal"])).toBe("Terminal");
    expect(isNumberedTerminalTitle("Terminal")).toBe(true);
    expect(isNumberedTerminalTitle("Terminal 2")).toBe(true);
    expect(isNumberedTerminalTitle("Terminal 12")).toBe(true);
    for (const title of ["bash", "Terminal 1", "Terminal 02", "My Terminal 2", "Terminal x"]) expect(isNumberedTerminalTitle(title), title).toBe(false);
  });

  it("is given to a bottom terminal other than the agent's, and a user's own name is kept", () => {
    const source = own("./bottom-panel-contribution.ts");
    expect(source).toContain('widget instanceof TerminalWidget && widget.id !== CLAUDE_TERMINAL_ID');
    expect(source).toContain("hasUserTitle");
    expect(source).toContain("term.setTitle(nextTerminalTitle(taken))");
  });
});

describe("the bottom tabs' order (S6e, B1)", () => {
  it("is the terminals, Problems, Output, then the Agent log", () => {
    expect(bottomOrder([AGENT_LOG_VIEW_ID, OUTPUT_VIEW_ID, PROBLEMS_VIEW_ID, "terminal-1"])).toEqual(["terminal-1", PROBLEMS_VIEW_ID, OUTPUT_VIEW_ID, AGENT_LOG_VIEW_ID]);
  });

  it("keeps the terminals in their own order, and puts a tab it does not know last", () => {
    expect(bottomOrder(["debug-console", "terminal-3", PROBLEMS_VIEW_ID, "terminal-1"])).toEqual(["terminal-3", "terminal-1", PROBLEMS_VIEW_ID, "debug-console"]);
  });

  it("tolerates the Agent log being absent, and is a fixed point", () => {
    const once = bottomOrder([OUTPUT_VIEW_ID, "terminal-1", PROBLEMS_VIEW_ID]);
    expect(once).toEqual(["terminal-1", PROBLEMS_VIEW_ID, OUTPUT_VIEW_ID]);
    expect(bottomOrder(once)).toEqual(once);
    expect(bottomOrder([])).toEqual([]);
  });

  it("names the ids Theia and the Agent log give their widgets", () => {
    expect(own("../../../../../node_modules/@theia/markers/src/browser/problem/problem-widget.tsx")).toContain(`PROBLEMS_WIDGET_ID = '${PROBLEMS_VIEW_ID}'`);
    expect(own("../../../../../node_modules/@theia/output/src/browser/output-widget.ts")).toContain(`ID = '${OUTPUT_VIEW_ID}'`);
    expect(own("../../../../../node_modules/@theia/terminal/src/browser/terminal-widget-impl.ts")).toContain("this.id = this._terminalDOMId;");
  });

  it("opens Output by default without bringing it to the front, through the restore registry", () => {
    const source = own("./bottom-panel-contribution.ts");
    expect(source).toContain("export class SpexrOutputRevealView implements RevealOnRestoreView");
    expect(source).toContain("readonly attachBehind = true;");
    expect(own("../spexr-frontend-module.ts")).toContain("bind(SpexrRevealOnRestore).toService(SpexrOutputRevealView)");
  });
});

describe("the Problems chip's tone (S6e, B3)", () => {
  it("is danger with any error, whatever else there is", () => {
    expect(problemSeverity([{ severity: 2 }, { severity: 1 }])).toBe("error");
    expect(problemSeverity([{ severity: 1 }])).toBe("error");
  });

  it("is warning with warnings alone, and neutral with nothing, information or hints", () => {
    expect(problemSeverity([{ severity: 2 }, { severity: 3 }])).toBe("warning");
    expect(problemSeverity([])).toBe("none");
    expect(problemSeverity([{ severity: 3 }, { severity: 4 }])).toBe("none");
  });

  it("reads a marker with no severity as an error, as the LSP says", () => {
    expect(problemSeverity([{}])).toBe("error");
  });

  it("is written on the tab as data-severity, which the style sheet reads", () => {
    expect(own("./bottom-panel-contribution.ts")).toContain("widget.title.dataset = { ...widget.title.dataset, severity }");
    expect(own("../style/spexr.css")).toContain('.lm-TabBar-tab[data-severity="warning"] .theia-badge-decorator-horizontal');
  });
});

describe("the close-panel button (S6e, B4)", () => {
  it("runs Theia's panel toggle, beside the terminals' +, on every bottom widget", () => {
    const source = own("./bottom-panel-contribution.ts");
    expect(source).toContain("command: CommonCommands.TOGGLE_BOTTOM_PANEL.id");
    expect(source).toContain('this.shell.getAreaFor(widget) === "bottom"');
    expect(own("../../../../../node_modules/@theia/core/src/browser/common-commands.ts")).toContain("id: 'core.toggle.bottom.panel'");
  });
});
