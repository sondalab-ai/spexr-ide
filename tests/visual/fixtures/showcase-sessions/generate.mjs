#!/usr/bin/env node
/**
 * Writes the transcripts the marketing capture seeds (tests/visual/showcase.ts).
 * Plain node, deterministic: run it again and the files do not change. The
 * output is committed so a reviewer reads the transcripts, not this script.
 *
 *   node tests/visual/fixtures/showcase-sessions/generate.mjs
 *
 * Same schema as the parity fixture (../claude-sessions/generate.mjs, whose
 * Session class this reuses). All content is invented for the showcase's
 * `ledgerline`, `atlas-api` and `field-notes` projects. `{{WS}}`, `{{ATLAS}}`
 * and `{{NOTES}}` stand for their real paths, known only when a run is
 * prepared. The opencode session is written as an `opencode export` document;
 * its `opencode db` row is built by showcase.ts, which knows the clock.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Session, patch, edit } from "../claude-sessions/generate.mjs";

const OUT = dirname(fileURLToPath(import.meta.url));

/**
 * One model turn: optional prose, then tool calls each answered by its
 * result. `open: true` leaves the last call unanswered (the session is
 * waiting on it).
 */
function turn(s, text, calls, { open = false } = {}) {
  calls.forEach((c, i) => {
    const last = i === calls.length - 1;
    if (c.edit) {
      const e = edit(s, c.edit.file, c.edit.from, c.edit.to, patch(c.edit.line, c.edit.ctx, [c.edit.from], [c.edit.to], c.edit.tail), 700);
      s.respond(i === 0 && text ? [{ type: "text", text }, e.call.block] : [e.call.block], { outputTokens: 220 + i * 30, gaps: [800, 40] });
      if (!(open && last)) e.finish();
      return;
    }
    const call = s.use(c.name, c.input);
    s.respond(i === 0 && text ? [{ type: "text", text }, call.block] : [call.block], { outputTokens: 110 + i * 25, gaps: [650 + (i % 3) * 120, 40] });
    if (!(open && last)) s.result(call, c.out, c.ms ?? 180, c.toolUseResult ? { toolUseResult: c.toolUseResult } : {});
  });
}

/** Session.write targets the parity fixture's folder; these go next to this script. */
const save = (s, file) => writeFileSync(join(OUT, file), s.lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

const say = (s, text) => s.respond([{ type: "text", text }], { outputTokens: 160, gaps: [1100], stop: "end_turn" });
const read = (file, out) => ({ name: "Read", input: { file_path: file }, out: out ?? `     1\t// ${file.split("/").pop()}` });
const grep = (pattern, path, out) => ({ name: "Grep", input: { pattern, path, output_mode: "content", "-n": true }, out });
const bash = (command, description, out, ms = 1800) => ({
  name: "Bash", input: { command, description }, out, ms,
  toolUseResult: { stdout: out, stderr: "", interrupted: false, isImage: false, noOutputExpected: false },
});
const finish = (s, prompt, title) => {
  s.meta({ type: "last-prompt", lastPrompt: prompt, leafUuid: s.parent });
  s.meta({ type: "ai-title", aiTitle: title });
};

const WS = "{{WS}}";
const ATLAS = "{{ATLAS}}";
const NOTES = "{{NOTES}}";

/* ── Reconcile window: live, waiting on a question (needs you) ───────────── */
{
  const s = new Session({ id: "3d6b0f2e-7a41-4c9e-8b52-1e0c9a7d4f30", dir: WS, branch: "reconcile-window", start: "2026-10-14T09:12:00.000Z", permissionMode: "acceptEdits" });
  const prompt = "Work on spec 0003: when two statement rows fit one ledger entry, the closer date should win. Start from the drift finding.";
  s.prompt(prompt);
  turn(s, "The drift report says match.ts takes the first candidate. I'll read the matcher and its tests first.", [
    read(`${WS}/docs/specs/0003-reconcile-window.md`),
    read(`${WS}/src/reconcile/match.ts`),
    read(`${WS}/src/reconcile/match.test.ts`),
    grep("daysApart", `${WS}/src`, "src/import/dates.ts:27:export function daysApart(a: Date, b: Date): number {\nsrc/reconcile/match.ts:23:      (e) => Math.abs(e.amount - row.amount) <= TOLERANCE_CENTS && daysApart(e.date, row.date) <= WINDOW_DAYS,"),
  ]);
  turn(s, "Confirmed: `find` returns the first entry in ledger order. I'll pick the candidate with the smallest day distance instead, and add a test for the tie.", [
    { edit: { file: `${WS}/src/reconcile/match.ts`, line: 21,
      from: "    const entry = [...free].find(",
      to: "    const entry = closestDate([...free].filter(",
      ctx: ["  for (const row of rows) {"], tail: ["      (e) => Math.abs(e.amount - row.amount) <= TOLERANCE_CENTS && daysApart(e.date, row.date) <= WINDOW_DAYS,"] } },
    { edit: { file: `${WS}/src/reconcile/match.test.ts`, line: 24,
      from: "test(\"four days is outside the window\", () => {",
      to: "test(\"the closer date wins a shared entry\", () => {\n  const [m] = reconcile([row(10, -500), row(12, -500)], [entry(\"a\", 12, -500)]);\n  assert.equal(m?.row.line, 12);\n});\n\ntest(\"four days is outside the window\", () => {",
      ctx: [""], tail: ["  assert.equal(reconcile([row(10, -500)], [entry(\"a\", 14, -500)]).length, 0);"] } },
    bash("node --test", "Run the tests", "✔ amounts become integer cents\n✔ a quoted description keeps its comma\n✔ en-US exports put the month first\n✔ a row matches an entry three days away\n✔ a cent of rounding still matches\n✔ the closer date wins a shared entry\n✔ four days is outside the window\nℹ tests 7\nℹ pass 7\nℹ fail 0"),
  ]);
  turn(s, "All 7 tests pass. I started the report preview so you can see the September statement against the ledger.", [
    bash("node src/cli.ts report statements/2026-09.csv --serve 4317", "Serve the reconcile report", "Report for 45 rows at http://localhost:4317/report"),
  ]);
  s.respond([{ type: "text", text: "The preview is at http://localhost:4317/report. Two rows still fail: a card refund with no entry inside three days, and interest the ledger never recorded." }], { outputTokens: 120, gaps: [900], stop: null });
  const ask = s.use("AskUserQuestion", { questions: [{ question: "Should rows with no entry be reported, or should the report also suggest a ledger entry for them?", header: "Unmatched", multiSelect: false, options: [{ label: "Report only", description: "List them with the reason." }, { label: "Suggest entries", description: "Propose an entry the user can accept." }] }] });
  s.respond([ask.block], { outputTokens: 140, gaps: [600] });
  save(s, "reconcile-window.jsonl");
}

/* ── Date locales: finished, opened a PR ─────────────────────────────────── */
{
  const s = new Session({ id: "9a1c5e38-2f07-4b6d-a3e9-5c8d0b2f7a16", dir: WS, branch: "date-locales", start: "2026-10-14T06:40:00.000Z", permissionMode: "acceptEdits" });
  const prompt = "Ship spec 0002: open the PR with the Spec trailer.";
  s.prompt(prompt);
  turn(s, "Validated already. I'll check the branch, run the tests once more and open the PR.", [
    bash("git status --short && git log --oneline -3", "Check the branch", "a41c9d2 dates: read en-US month-first dates\n7e03b18 dates: name the line of an impossible date\n2f9a6c4 csv: read the locale per account"),
    bash("node --test", "Run the tests", "ℹ tests 6\nℹ pass 6\nℹ fail 0"),
    bash("git push -u origin date-locales", "Push the branch", "branch 'date-locales' set up to track 'origin/date-locales'."),
    bash("gh pr create --fill --label spec", "Open the PR", "https://github.com/ledgerline/ledgerline/pull/42"),
  ]);
  say(s, "PR opened: https://github.com/ledgerline/ledgerline/pull/42. Each commit carries `Spec: 0002-date-locales`.");
  finish(s, prompt, "Date locales");
  save(s, "date-locales.jsonl");
}

/* ── CSV import: finished yesterday ──────────────────────────────────────── */
{
  const s = new Session({ id: "c27e9b04-6d13-4f8a-9e75-0b4a3c1d8e62", dir: WS, branch: "main", start: "2026-10-13T08:05:00.000Z", permissionMode: "default" });
  const prompt = "Implement spec 0001: read the bank's CSV export, amounts as integer cents.";
  s.prompt(prompt);
  turn(s, "I'll read the spec and the memory note on amounts before writing the parser.", [
    read(`${WS}/docs/specs/0001-csv-import.md`),
    read(`${WS}/docs/memory/amounts-are-integer-cents.md`),
    { name: "Write", input: { file_path: `${WS}/src/import/csv.ts`, content: "export function parseStatement() {}" }, out: `File created successfully at: ${WS}/src/import/csv.ts` },
    { name: "Write", input: { file_path: `${WS}/src/import/csv.test.ts`, content: "import { test } from \"node:test\";" }, out: `File created successfully at: ${WS}/src/import/csv.test.ts` },
    bash("node --test", "Run the tests", "ℹ tests 3\nℹ pass 3\nℹ fail 0"),
  ]);
  say(s, "The importer reads Date, Description and Amount, keeps quoted commas, and never touches floating point. All three acceptance criteria have a test.");
  finish(s, prompt, "CSV import");
  save(s, "csv-import.jsonl");
}

/* ── atlas-api: live and working ─────────────────────────────────────────── */
{
  const s = new Session({ id: "5f8d2a71-0c94-4e3b-b6a8-7d1e4f9c2b05", dir: ATLAS, branch: "rate-limits", start: "2026-10-14T09:30:00.000Z", permissionMode: "auto" });
  s.prompt("Add per-key rate limits to the public endpoints: 60 requests a minute, with a Retry-After header.");
  turn(s, "I'll find where requests are authenticated; the limiter belongs right after the key is known.", [
    grep("apiKey", `${ATLAS}/src`, "src/auth/keys.ts:12:export function apiKey(req: Request): string | undefined {\nsrc/server.ts:31:  const key = apiKey(req);"),
    read(`${ATLAS}/src/server.ts`),
    { name: "Write", input: { file_path: `${ATLAS}/src/limits/window.ts`, content: "export class SlidingWindow {}" }, out: `File created successfully at: ${ATLAS}/src/limits/window.ts` },
    { edit: { file: `${ATLAS}/src/server.ts`, line: 31, from: "  const key = apiKey(req);", to: "  const key = apiKey(req);\n  const wait = limiter.take(key);\n  if (wait > 0) return tooMany(wait);", ctx: ["export async function handle(req: Request) {"], tail: ["  return route(req, key);"] } },
  ]);
  turn(s, "The limiter is wired in. Running the integration tests against a local server.", [
    bash("npm test -- --grep limits", "Run the rate-limit tests", ""),
  ], { open: true });
  save(s, "atlas-rate-limits.jsonl");
}

/* ── atlas-api: finished ─────────────────────────────────────────────────── */
{
  const s = new Session({ id: "e04b7c19-3a52-4d86-8f1e-2c9b5a0d7e43", dir: ATLAS, branch: "main", start: "2026-10-14T03:10:00.000Z", permissionMode: "default" });
  const prompt = "Clean up openapi.yaml: drop the endpoints we removed in 2.0 and fix the examples.";
  s.prompt(prompt);
  turn(s, "I'll compare the spec with the routes the server actually registers.", [
    grep("app\\.(get|post|put|delete)", `${ATLAS}/src`, "src/routes.ts:8:app.get(\"/v2/accounts\", listAccounts);\nsrc/routes.ts:9:app.get(\"/v2/accounts/:id\", getAccount);\nsrc/routes.ts:10:app.post(\"/v2/transfers\", createTransfer);"),
    read(`${ATLAS}/openapi.yaml`),
    bash("npx @redocly/cli lint openapi.yaml", "Lint the OpenAPI file", "Woohoo! Your API description is valid. 🎉"),
  ]);
  say(s, "Removed four 1.x endpoints and fixed six examples that used old field names. The file lints clean.");
  finish(s, prompt, "OpenAPI cleanup");
  save(s, "atlas-openapi.jsonl");
}

/* ── field-notes: two finished sessions ──────────────────────────────────── */
{
  const s = new Session({ id: "7c3e1a96-4b28-4f05-a9d7-6e2b8c0f1d54", dir: NOTES, branch: "main", start: "2026-10-14T08:20:00.000Z", permissionMode: "default" });
  const prompt = "Search across notes is slow past a thousand files. Build an index.";
  s.prompt(prompt);
  turn(s, "I'll measure first, then add an inverted index that updates when a note is saved.", [
    bash("node bench/search.js --notes 2000", "Measure search", "2000 notes: 412 ms per query"),
    { name: "Write", input: { file_path: `${NOTES}/src/search/index.ts`, content: "export class NoteIndex {}" }, out: `File created successfully at: ${NOTES}/src/search/index.ts` },
    bash("node bench/search.js --notes 2000", "Measure again", "2000 notes: 6 ms per query"),
  ]);
  say(s, "Queries over 2,000 notes went from 412 ms to 6 ms. The index updates on save.");
  finish(s, prompt, "Search index");
  save(s, "notes-search.jsonl");
}
{
  const s = new Session({ id: "b61f0d83-9e27-4a5c-8d3b-4f7a2e1c6b98", dir: NOTES, branch: "main", start: "2026-10-12T10:00:00.000Z", permissionMode: "default" });
  const prompt = "Add a tag editor to the note header.";
  s.prompt(prompt);
  turn(s, "I'll add the editor as a small component next to the title.", [
    read(`${NOTES}/src/ui/NoteHeader.tsx`),
    { name: "Write", input: { file_path: `${NOTES}/src/ui/TagEditor.tsx`, content: "export function TagEditor() {}" }, out: `File created successfully at: ${NOTES}/src/ui/TagEditor.tsx` },
    bash("npm test", "Run the tests", "Tests: 31 passed, 31 total"),
  ]);
  say(s, "Tags can be added and removed from the header; Enter adds, Backspace on an empty field removes the last one.");
  finish(s, prompt, "Tag editor");
  save(s, "notes-tags.jsonl");
}

/* ── opencode: "Fixture refresh", an `opencode export` document ──────────── */
{
  const text = (t) => ({ type: "text", text: t });
  const tool = (name, input) => ({ type: "tool", tool: name, state: { input, status: "completed" } });
  const doc = {
    info: { id: "ses_7Hq2LkPz9Rw4ledger", title: "Fixture refresh", directory: WS },
    messages: [
      { info: { role: "user" }, parts: [text("Refresh the sample statements in test/fixtures from the two banks' newest export format.")] },
      { info: { role: "assistant" }, parts: [text("I'll compare the old samples with the new column layout first."), tool("read", { filePath: `${WS}/README.md` }), tool("glob", { pattern: "test/fixtures/*.csv" })] },
      { info: { role: "assistant" }, parts: [tool("edit", { filePath: `${WS}/test/fixtures/gb-2026-09.csv` }), tool("bash", { command: "node --test" })] },
      { info: { role: "assistant" }, parts: [text("Both samples now use the new header order, and the tests still pass.")] },
    ],
  };
  writeFileSync(join(OUT, "opencode-fixture-refresh.json"), JSON.stringify(doc, null, 2) + "\n");
}
