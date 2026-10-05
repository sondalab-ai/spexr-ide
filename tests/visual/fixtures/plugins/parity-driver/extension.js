// @ts-check
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

    const language = await waitForLanguageFeatures(doc.uri, 60_000);
    // The Explorer goes in front of the agent terminal the left panel reveals
    // at startup; explorer.autoReveal then selects resolve.ts in the tree.
    const explorer = await tryCommand("workbench.view.explorer");
    const terminal = showShellTerminal();
    // Focus back to the editor, then the cursor again: showing the Explorer can move it.
    const { editor } = await show("src/probe/resolve.ts");
    const scroll = await placeCursor(editor);

    ack("base", {
      ok: true,
      cleared,
      explorer,
      language,
      terminal,
      topLine: scroll.topLine,
      scroll,
      file: path.basename(editor.document.fileName),
      selections: editor.selections.map((s) => [s.start.line + 1, s.start.character + 1, s.end.line + 1, s.end.character + 1]),
      visible: editor.visibleRanges.map((r) => [r.start.line + 1, r.end.line + 1]),
    });
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

  ack("activated", { ok: true });
}

function deactivate() {}

module.exports = { activate, deactivate };
