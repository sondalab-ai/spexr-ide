"use strict";

/**
 * Fixture-only VS Code extension for tests/visual.
 *
 * Each command sets up one screenshot scene, then writes an acknowledgement to
 * $SPEXR_VISUAL_ACK that the Playwright side waits for. It is loaded only by
 * tests/visual/app.ts through THEIA_PLUGINS, so no test hook goes into the
 * product. Plain CommonJS on purpose: there is no build step.
 */

const fs = require("fs");
const path = require("path");
// Provided by the plugin host; not a dependency of this repository.
const vscode = require("vscode");

const ACK_DIR = process.env.SPEXR_VISUAL_ACK;

/** The demo's cursor (41:18) and selected line (45), 1-based as the demo numbers them. */
const CURSOR = { line: 41, column: 18 };
const SELECTED_LINE = 45;
const TOP_LINE = 36;
/** The demo's warning squiggle: line 46, `cache.write(probe.key, answer)`. */
const WARNING = { line: 46, text: "cache.write(probe.key, answer)", message: "Promise returned is not awaited" };

/**
 * S6a, the demo's other content. The second warning is in cache.ts, which is a
 * background tab: resolve.ts's squiggle and the editor's lines stay as the
 * base scene has them. The problems count is then 2, as the demo's.
 */
const SECOND_WARNING = { file: "src/probe/cache.ts", line: 22, text: "Date.now()", message: "Clock read in a hot path" };
/** Dirty files: one space at the end of line 1, so no line moves and none shows in the 36-50 window. */
const DIRTY_FILES = ["src/probe/resolve.ts", "src/probe/evidence.ts"];
/** The one notification the bell holds. */
const NOTIFICATION = "Cache warmed: 212 answers kept";

/**
 * Write `<ack dir>/<name>.json`. Written atomically (temp file, then rename)
 * so the poller never reads half a file.
 */
function ack(name, data) {
  if (!ACK_DIR) return;
  fs.mkdirSync(ACK_DIR, { recursive: true });
  const file = path.join(ACK_DIR, `${name}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ at: new Date().toISOString(), ...data }, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

/**
 * Run a command this host may not have; returns true, or the error text. A
 * command that returns a widget ran, but its result cannot travel back to the
 * plugin host, and that encoding error is not a failure.
 */
async function tryCommand(id, ...args) {
  try {
    await vscode.commands.executeCommand(id, ...args);
    return true;
  } catch (err) {
    const message = String((err && err.message) || err);
    return /Error during encoding/.test(message) ? true : message;
  }
}

/** Resolve after `ms`; only used between polls, never as a scene settle. */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until the TypeScript extension answers for `uri` with document symbols.
 * They feed the breadcrumbs, and the same language server colours the code
 * with semantic tokens, so a capture taken before it is up is a different
 * picture. Theia has no API command for semantic tokens; the capture side
 * waits for the pixels to settle instead.
 */
async function waitForLanguageFeatures(uri, timeoutMs) {
  const started = Date.now();
  let symbols = 0;
  while (Date.now() - started < timeoutMs) {
    try {
      const found = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", uri);
      symbols = Array.isArray(found) ? found.length : 0;
    } catch {
      symbols = 0;
    }
    if (symbols > 0) break;
    await delay(500);
  }
  return { symbols, waitedMs: Date.now() - started };
}

function workspaceUri(relative) {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) throw new Error("no workspace folder is open");
  return vscode.Uri.joinPath(folder.uri, ...relative.split("/"));
}

async function show(relative) {
  const doc = await vscode.workspace.openTextDocument(workspaceUri(relative));
  const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
  return { doc, editor };
}

/**
 * Cursor at 41:18, line 45 selected, line 36 at the top: the demo's editor
 * state. The scroll is re-applied until line 36 stays first for three checks
 * in a row; if `revealRange` never gets there, `revealLine` and then
 * `editorScroll` are tried. Returns the first visible line and how it got
 * there, for the summary.
 */
async function placeCursor(editor) {
  const selected = editor.document.lineAt(SELECTED_LINE - 1);
  editor.selections = [
    new vscode.Selection(CURSOR.line - 1, CURSOR.column - 1, CURSOR.line - 1, CURSOR.column - 1),
    new vscode.Selection(SELECTED_LINE - 1, 0, SELECTED_LINE - 1, selected.text.length),
  ];
  const top = () => (editor.visibleRanges[0] ? editor.visibleRanges[0].start.line + 1 : 0);
  const trace = [];
  const attempts = [
    ["revealRange", () => editor.revealRange(new vscode.Range(TOP_LINE - 1, 0, TOP_LINE - 1, 0), vscode.TextEditorRevealType.AtTop)],
    ["revealLine", () => tryCommand("revealLine", { lineNumber: TOP_LINE - 1, at: "top" })],
    ["editorScroll", () => tryCommand("editorScroll", { to: top() > TOP_LINE ? "up" : "down", by: "line", value: Math.abs(top() - TOP_LINE) })],
  ];
  for (const [how, run] of attempts) {
    let steady = 0;
    for (let i = 0; i < 8 && steady < 3; i++) {
      if (top() === TOP_LINE) {
        steady++;
      } else {
        steady = 0;
        const result = await run();
        trace.push(`${how}: ${top()}${result === true || result === undefined ? "" : ` (${result})`}`);
      }
      await delay(250);
    }
    if (steady >= 3) return { topLine: top(), how, trace };
  }
  return { topLine: top(), how: "none", trace };
}

/**
 * Put the shell terminal in front of the bottom panel, as the demo has it,
 * without taking focus. The agent terminal lives in the left panel and is
 * left alone; returns every terminal's name, for the summary.
 */
function showShellTerminal() {
  const names = vscode.window.terminals.map((t) => t.name);
  const shell = vscode.window.terminals.find((t) => /^(bash|zsh|sh|fish)$/.test(t.name));
  if (shell) shell.show(true);
  return { names, shown: shell ? shell.name : null };
}

/** The shell terminal, waited for: the panel may open a moment after the window. */
async function waitForShellTerminal(timeoutMs) {
  const started = Date.now();
  for (;;) {
    const shell = vscode.window.terminals.find((t) => /^(bash|zsh|sh|fish)$/.test(t.name));
    if (shell) return shell;
    if (Date.now() - started > timeoutMs) return undefined;
    await delay(250);
  }
}

/** Put one space at the end of the first line, which leaves the file unsaved and every line where it was. */
async function makeDirty(relative) {
  const { doc } = await show(relative);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, new vscode.Position(0, doc.lineAt(0).text.length), " ");
  const applied = await vscode.workspace.applyEdit(edit);
  return { file: relative, applied, dirty: doc.isDirty };
}

/**
 * Raise the demo's one notification, then hide its toast: the bell keeps the
 * dot and the capture has no toast over it. The toast arrives over RPC, so
 * hiding is repeated until the first attempt after it has surely landed.
 */
async function notifyWithoutToast() {
  void vscode.window.showInformationMessage(NOTIFICATION);
  for (let i = 0; i < 8; i++) {
    await delay(300);
    await tryCommand("notifications.commands.hide");
  }
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection("parity");
  context.subscriptions.push(diagnostics);

  const register = (id, run) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        try {
          await run();
        } catch (err) {
          ack(id.replace(/^parity\./, ""), { ok: false, error: String((err && err.stack) || err) });
        }
      }),
    );

  register("parity.probe", async () => {
    ack("probe", {
      ok: true,
      vscodeApi: vscode.version,
      extensions: vscode.extensions.all.map((e) => e.id).sort(),
    });
  });

  register("parity.base", async () => {
    const cleared = await tryCommand("notifications.commands.clearAll");
    // Opened in the demo's tab order; resolve.ts is shown last so it is in front.
    await show("src/probe/resolve.ts");
    await show("src/probe/cache.ts");
    await show("src/probe/evidence.ts");
    const { doc } = await show("src/probe/resolve.ts");

    const line = doc.lineAt(WARNING.line - 1);
    const start = line.text.indexOf(WARNING.text);
    const warning = new vscode.Diagnostic(
      new vscode.Range(WARNING.line - 1, start, WARNING.line - 1, start + WARNING.text.length),
      WARNING.message,
      vscode.DiagnosticSeverity.Warning,
    );
    warning.source = "parity";
    diagnostics.set(doc.uri, [warning]);
    const cacheDoc = await vscode.workspace.openTextDocument(workspaceUri(SECOND_WARNING.file));
    const cacheLine = cacheDoc.lineAt(SECOND_WARNING.line - 1);
    const at = cacheLine.text.indexOf(SECOND_WARNING.text);
    const second = new vscode.Diagnostic(
      new vscode.Range(SECOND_WARNING.line - 1, at, SECOND_WARNING.line - 1, at + SECOND_WARNING.text.length),
      SECOND_WARNING.message,
      vscode.DiagnosticSeverity.Warning,
    );
    second.source = "parity";
    diagnostics.set(cacheDoc.uri, [second]);
    const dirtied = [];
    for (const file of DIRTY_FILES) dirtied.push(await makeDirty(file));

    const language = await waitForLanguageFeatures(doc.uri, 60_000);
    // The Explorer goes in front of the agent terminal the left panel reveals
    // at startup; explorer.autoReveal then selects resolve.ts in the tree.
    const explorer = await tryCommand("workbench.view.explorer");
    const terminal = showShellTerminal();
    // Focus back to the editor, then the cursor again: showing the Explorer can move it.
    const { editor } = await show("src/probe/resolve.ts");
    const scroll = await placeCursor(editor);
    await notifyWithoutToast();

    ack("base", {
      ok: true,
      cleared,
      explorer,
      language,
      terminal,
      topLine: scroll.topLine,
      scroll,
      file: path.basename(editor.document.fileName),
      fixture: {
        problems: vscode.languages.getDiagnostics().reduce((n, [, list]) => n + list.length, 0),
        dirtied,
        dirty: vscode.workspace.textDocuments.filter((d) => d.isDirty).map((d) => path.basename(d.fileName)),
      },
      selections: editor.selections.map((s) => [s.start.line + 1, s.start.character + 1, s.end.line + 1, s.end.character + 1]),
      visible: editor.visibleRanges.map((r) => [r.start.line + 1, r.end.line + 1]),
    });
  });

  // S6a: the shell terminal runs the two commands the demo's panel shows. The
  // pnpm stub (fixtures/bin/pnpm) acknowledges each one on its own, so the
  // capture knows the command ran without reading the terminal's canvas.
  register("parity.shell", async () => {
    const shell = await waitForShellTerminal(60_000);
    if (!shell) throw new Error("no shell terminal to run the demo's commands in");
    shell.show(true);
    shell.sendText("pnpm test probe");
    ack("shell", { ok: true, terminal: shell.name });
  });

  register("parity.shell2", async () => {
    const shell = await waitForShellTerminal(5_000);
    if (!shell) throw new Error("no shell terminal for the second command");
    shell.sendText("pnpm sl-audit");
    ack("shell2", { ok: true, terminal: shell.name });
  });

  // Before the app closes: an unsaved file would otherwise stop it with a prompt.
  register("parity.cleanup", async () => {
    const saved = [];
    for (const doc of vscode.workspace.textDocuments.filter((d) => d.isDirty)) {
      saved.push({ file: path.basename(doc.fileName), saved: await doc.save() });
    }
    ack("cleanup", { ok: true, saved });
  });

  register("parity.toast", async () => {
    const cleared = await tryCommand("notifications.commands.clearAll");
    // Not awaited: the promise settles only when someone clicks or dismisses.
    void vscode.window.showInformationMessage("Probe saved", "Undo");
    ack("toast", { ok: true, cleared });
  });

  register("parity.focusTree", async () => {
    const cleared = await tryCommand("notifications.commands.clearAll");
    const focused = await tryCommand("workbench.files.action.focusFilesExplorer");
    ack("focusTree", { ok: true, cleared, focused });
  });

  // late-font: two panel terminals, each shown in turn, so the first is an
  // opened terminal hidden behind the second when the held faces are released.
  const openTerminal = async (name) => {
    const terminal = vscode.window.createTerminal({ name });
    terminal.show(true);
    const pid = await terminal.processId;
    return { name, pid: pid ?? null };
  };
  register("parity.lateOpenA", async () => {
    ack("lateOpenA", { ok: true, terminal: await openTerminal("late-a") });
  });
  register("parity.lateOpenB", async () => {
    ack("lateOpenB", { ok: true, terminal: await openTerminal("late-b"), names: vscode.window.terminals.map((t) => t.name) });
  });
  // Shows late-a again and runs `true` in it: the new prompt moves the cursor,
  // which is when xterm sizes its helper textarea to the current cell.
  register("parity.lateShowA", async () => {
    const terminal = vscode.window.terminals.find((t) => t.name === "late-a");
    if (!terminal) throw new Error("no late-a terminal");
    terminal.show(true);
    terminal.sendText("true");
    ack("lateShowA", { ok: true });
  });

  ack("activated", { ok: true });
}

function deactivate() {}

module.exports = { activate, deactivate };
