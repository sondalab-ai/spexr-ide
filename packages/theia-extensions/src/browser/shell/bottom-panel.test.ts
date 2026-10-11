import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AGENT_LOG_VIEW_ID, OUTPUT_VIEW_ID, PROBLEMS_VIEW_ID, bottomOrder, nextTerminalTitle, severityFromStat, titleFor } from "./bottom-panel.js";

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
  });
});

describe("which terminals are numbered (S6e, B2)", () => {
  it("replaces Theia's own default, whose counter also counts the agent's and the wall's terminals", () => {
    // Theia would have called the new terminal "Terminal 4"; with only "Terminal" in use it is the second.
    expect(titleFor({ kind: "user" }, ["Terminal"])).toBe("Terminal 2");
    expect(titleFor({ kind: "user", useServerTitle: true }, [])).toBe("Terminal");
  });

  it("numbers by every terminal's label, so the lowest free number is used", () => {
    expect(titleFor({}, ["Terminal", "Terminal 3", "Agent", "spexr"])).toBe("Terminal 2");
  });

  it("keeps a terminal its creator named: a project's, the wall's, a task's, a plugin's", () => {
    expect(titleFor({ kind: "user", useServerTitle: false }, [])).toBeUndefined(); // openTerminalAt, the wall's terminals
    expect(titleFor({ kind: "task" }, [])).toBeUndefined();
    expect(titleFor({ kind: "plugin" }, [])).toBeUndefined();
  });

  it("keeps a terminal someone named, or that was numbered already (Theia's hasUserTitle, which a restored layout keeps)", () => {
    expect(titleFor({ kind: "user", hasUserTitle: true }, ["Terminal"])).toBeUndefined();
  });

  it("is applied to a terminal as it joins the bottom and to the saved ones after a restore, not for the agent's terminal by id but by how it was made", () => {
    const source = own("./bottom-panel-contribution.ts");
    expect(source).toContain("if (widget instanceof TerminalWidget) this.titleTerminal(widget);");
    expect(source).toContain("for (const widget of this.shell.getWidgets(\"bottom\")) if (widget instanceof TerminalWidget) this.titleTerminal(widget);");
    expect(source).toContain("const taken = this.terminals.all.filter((t) => t !== term).map((t) => t.title.label);");
    expect(source).not.toContain("CLAUDE_TERMINAL_ID");
    expect(source).toContain("term.setTitle(title)");
  });
});

describe("the bottom tabs' order (S6e, B1)", () => {
  it("is the terminals, Problems, Output, then the Agent log", () => {
    expect(bottomOrder([AGENT_LOG_VIEW_ID, OUTPUT_VIEW_ID, PROBLEMS_VIEW_ID, "terminal-1"])).toEqual(["terminal-1", PROBLEMS_VIEW_ID, OUTPUT_VIEW_ID, AGENT_LOG_VIEW_ID]);
  });

  it("puts a terminal ahead of Problems whatever order they joined in, and keeps each terminal where it is among the others", () => {
    expect(bottomOrder([PROBLEMS_VIEW_ID, "terminal-2", OUTPUT_VIEW_ID, "terminal-1"])).toEqual(["terminal-2", "terminal-1", PROBLEMS_VIEW_ID, OUTPUT_VIEW_ID]);
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

  it("is put right when a widget joins and once the layout is restored, and a tab the user drags stays where it is dropped", () => {
    const source = own("./bottom-panel-contribution.ts");
    expect(source).toContain("onDidInitializeLayout(): void {");
    expect(source).toContain("this.enforceOrder();");
    expect(source).not.toContain("tabMoved");
  });

  it("attaches Output once per workspace, behind the terminals, and again after Reset Layout", () => {
    const source = own("./bottom-panel-contribution.ts");
    expect(source).toContain("runMigrationOnce(store, OUTPUT_ATTACH_MIGRATION_ID");
    expect(source).toContain("openView({ activate: false, reveal: false })");
    const layout = own("./spexr-shell-layout-contribution.ts");
    expect(layout).toMatch(/await this\.removeActivityViews\(\);\s*await this\.attachOutput\(\);\s*await this\.revealRegisteredDefaults\(\);/);
    expect(layout).toMatch(/await this\.removeActivityViews\(\);\s*await this\.attachOutput\(\);\s*await this\.defaultLayout\.resetSizes\(\);/);
    expect(JSON.parse(own("../../../package.json")).dependencies["@theia/output"]).toBe("1.75.0");
  });
});

describe("the Problems chip's tone (S6e, B3)", () => {
  it("is danger with any error, whatever else there is", () => {
    expect(severityFromStat({ errors: 1, warnings: 3 })).toBe("error");
  });

  it("is warning with warnings alone, and neutral with nothing or only information, which the stat does not count", () => {
    expect(severityFromStat({ errors: 0, warnings: 2 })).toBe("warning");
    expect(severityFromStat({ errors: 0, warnings: 0 })).toBe("none");
  });

  it("is read from the problem manager's own stat, the one the chip's count is, and written on the tab as data-severity", () => {
    const source = own("./bottom-panel-contribution.ts");
    expect(source).toContain("severityFromStat(this.problems.getProblemStat())");
    expect(source).toContain("widget.title.dataset = { ...widget.title.dataset, severity }");
    expect(source).toContain("if (widget.id === PROBLEMS_VIEW_ID) this.tintProblems();");
    expect(own("../style/spexr.css")).toContain('.lm-TabBar-tab[data-severity="warning"] .theia-badge-decorator-horizontal');
  });
});

describe("the close-panel button (S6e, B4)", () => {
  it("collapses the panel and hands the focus back to the editor, beside the terminals' +, on every bottom widget", () => {
    const source = own("./bottom-panel-contribution.ts");
    expect(source).toContain("command: CLOSE_PANEL_COMMAND.id");
    expect(source).toContain('await this.shell.collapsePanel("bottom");');
    expect(source).toContain("await this.shell.activateWidget(editor.id);");
    expect(source).toContain('nls.localize("spexr/bottom/close"');
    expect(source).toContain('this.shell.getAreaFor(widget) === "bottom"');
  });
});
