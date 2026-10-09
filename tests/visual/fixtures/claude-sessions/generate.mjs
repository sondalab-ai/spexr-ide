#!/usr/bin/env node
/**
 * Writes the four Claude Code transcripts the parity fixture seeds
 * (tests/visual/prepare.ts: seedSessions). Plain node, deterministic: run it
 * again and the files do not change. The output is committed so a reviewer
 * reads the transcripts, not this script.
 *
 *   node tests/visual/fixtures/claude-sessions/generate.mjs
 *
 * The schema is Claude Code's interactive (`entrypoint: "cli"`) JSONL as of
 * 2.1.x: a `mode` and a `permission-mode` record, user and assistant entries
 * with `uuid`/`parentUuid`/`timestamp`/`cwd`/`sessionId`, one assistant entry
 * per content block with the `message.id` shared by the blocks of a response,
 * `usage` on each, `tool_use.id` answered by a `tool_result.tool_use_id`, and
 * `toolUseResult` beside it (`structuredPatch` for Edit, `oldTodos`/`newTodos`
 * for TodoWrite). All content is invented for the fixture's `probe-engine`
 * and a `prism-site`; none is copied from a real session.
 *
 * `{{WS}}` and `{{SITE}}` stand for the two workspaces' real paths, known only
 * when a run is prepared; they sit inside JSON strings so a template line is
 * valid JSON as it is.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const VERSION = "2.1.289";
const MODEL = "claude-opus-5-5";

/** A stable v4-shaped uuid from a label, so reruns do not churn the files. */
function uuid(label) {
  const h = createHash("sha1").update(label).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** One transcript under construction: a clock, a parent chain and the records so far. */
class Session {
  constructor({ id, dir, branch, start, permissionMode }) {
    this.id = id;
    this.dir = dir;
    this.branch = branch;
    this.clock = Date.parse(start);
    this.lines = [];
    this.parent = null;
    this.n = 0;
    this.msg = 0;
    this.tools = 0;
    this.lines.push({ type: "mode", mode: "normal", sessionId: id });
    this.lines.push({ type: "permission-mode", permissionMode, sessionId: id });
  }

  /** Advance the clock and return the timestamp. */
  tick(ms) {
    this.clock += ms;
    return new Date(this.clock).toISOString();
  }

  base(type, message, ms, extra = {}) {
    const id = uuid(`${this.id}:${this.n++}`);
    const entry = {
      parentUuid: this.parent,
      isSidechain: false,
      ...extra,
      type,
      message,
      uuid: id,
      timestamp: this.tick(ms),
      userType: "external",
      entrypoint: "cli",
      cwd: this.dir,
      sessionId: this.id,
      version: VERSION,
      gitBranch: this.branch,
    };
    this.parent = id;
    this.lines.push(entry);
    return entry;
  }

  prompt(text, ms = 4000) {
    return this.base("user", { role: "user", content: text }, ms, { promptId: uuid(`${this.id}:p:${this.n}`) });
  }

  /**
   * One API response: its content blocks, each its own entry, all with the
   * same `message.id` and `usage`. `gaps` is the milliseconds before each block.
   */
  respond(blocks, { outputTokens, gaps, stop = "tool_use" }) {
    const id = `msg_${createHash("sha1").update(`${this.id}:m:${this.msg++}`).digest("hex").slice(0, 24)}`;
    const request = `req_${createHash("sha1").update(`${id}:r`).digest("hex").slice(0, 24)}`;
    const usage = {
      input_tokens: 6,
      cache_creation_input_tokens: 1180 + (this.msg % 7) * 40,
      cache_read_input_tokens: 21_400 + this.msg * 310,
      output_tokens: outputTokens,
      service_tier: "standard",
    };
    blocks.forEach((block, i) => {
      const last = i === blocks.length - 1;
      this.base(
        "assistant",
        { model: MODEL, id, type: "message", role: "assistant", content: [block], stop_reason: last ? stop : null, stop_sequence: null, usage },
        gaps[i] ?? 30,
        { requestId: request },
      );
    });
    return id;
  }

  /** The tool_use block, counted; its id pairs with {@link result}. */
  use(name, input) {
    this.tools++;
    const id = `toolu_${createHash("sha1").update(`${this.id}:t:${this.tools}`).digest("hex").slice(0, 22)}`;
    return { id, block: { type: "tool_use", id, name, input } };
  }

  result(call, text, ms, { isError = false, toolUseResult } = {}) {
    const block = { tool_use_id: call.id, type: "tool_result", content: text };
    if (isError) block.is_error = true;
    const extra = { sourceToolAssistantUUID: this.parent };
    if (toolUseResult !== undefined) extra.toolUseResult = toolUseResult;
    return this.base("user", { role: "user", content: [block] }, ms, extra);
  }

  meta(record) {
    this.lines.push({ ...record, sessionId: this.id });
  }

  write(file) {
    writeFileSync(join(OUT, file), this.lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return this.tools;
  }
}

/** A hunk the way Claude Code's structuredPatch holds it. */
function patch(start, context, removed, added, tail) {
  const lines = [...context.map((l) => ` ${l}`), ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`), ...tail.map((l) => ` ${l}`)];
  return [{ oldStart: start, oldLines: context.length + removed.length + tail.length, newStart: start, newLines: context.length + added.length + tail.length, lines }];
}

function edit(s, file, oldString, newString, hunk, ms) {
  const call = s.use("Edit", { file_path: file, old_string: oldString, new_string: newString, replace_all: false });
  return { call, finish: () => s.result(call, `The file ${file} has been updated successfully.`, ms, {
    toolUseResult: { filePath: file, oldString, newString, structuredPatch: hunk, userModified: false, replaceAll: false },
  }) };
}

/** Claude Code's TodoWrite items: `status` is `pending`, `in_progress` or `completed`. */
const ACTIVE = { "Await the write": "Awaiting the write", "Re-run the probe suite": "Re-running the probe suite", "Fix the R finding": "Fixing the R finding" };
function todos(items) {
  return items.map(([content, status]) => ({ content, status, activeForm: ACTIVE[content] }));
}

/* ── 1. Refactor the audit: live, 14 tools, the last one unresolved ─────────── */
{
  const WS = "{{WS}}";
  const s = new Session({ id: "8f2a4c1e-3b7d-4e52-9a61-0c5d2e8b7f13", dir: WS, branch: "main", start: "2026-10-09T13:58:02.000Z", permissionMode: "auto" });
  s.prompt("Make cache.write awaited and keep the p95 under 2 ms. Show me the evidence.");
  const plan = (a, b, c) => todos([["Await the write", a], ["Re-run the probe suite", b], ["Fix the R finding", c]]);
  let previous = [];
  const todo = (list, ms) => {
    const call = s.use("TodoWrite", { todos: list });
    s.respond([call.block], { outputTokens: 150, gaps: [ms] });
    s.result(call, "Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress.", 40, { toolUseResult: { oldTodos: previous, newTodos: list } });
    previous = list;
  };

  s.respond([{ type: "thinking", thinking: "", signature: "fixture" }], { outputTokens: 90, gaps: [900], stop: null });
  s.respond([{ type: "text", text: "Found it: the write races the return. I'll await it and measure." }], { outputTokens: 40, gaps: [800], stop: "end_turn" });
  todo(plan("in_progress", "pending", "pending"), 600);

  const grep = s.use("Grep", { pattern: "cache\\.write", path: "{{WS}}/src", output_mode: "content", "-n": true });
  s.respond([grep.block], { outputTokens: 120, gaps: [700] });
  s.result(grep, "src/probe/resolve.ts:46:  cache.write(probe.key, answer);\nsrc/probe/cache.ts:26:  async write(key: string, answer: Answer): Promise<void> {", 180);

  const readCache = s.use("Read", { file_path: `${WS}/src/probe/cache.ts` });
  s.respond([readCache.block], { outputTokens: 110, gaps: [650] });
  s.result(readCache, "     1\timport { Evidence } from \"./evidence\";\n     2\timport type { Answer } from \"./types\";\n     3\t\n     4\texport { Evidence };", 200, {
    toolUseResult: { type: "text", file: { filePath: `${WS}/src/probe/cache.ts`, numLines: 33, startLine: 1, totalLines: 33 } },
  });

  const readResolve = s.use("Read", { file_path: `${WS}/src/probe/resolve.ts` });
  s.respond([readResolve.block], { outputTokens: 105, gaps: [600] });
  s.result(readResolve, "    36\timport { Cache, Evidence } from \"./cache\";\n    37\timport type { Probe, Answer } from \"./types\";", 150);

  const readTest = s.use("Read", { file_path: `${WS}/src/probe/resolve.test.ts` });
  s.respond([readTest.block], { outputTokens: 100, gaps: [600] });
  s.result(readTest, "     1\timport { describe, expect, it } from \"vitest\";", 140);

  const glob = s.use("Glob", { pattern: "src/**/*.ts", path: WS });
  s.respond([glob.block], { outputTokens: 95, gaps: [550] });
  s.result(glob, "src/probe/resolve.ts\nsrc/probe/cache.ts\nsrc/probe/evidence.ts\nsrc/probe/resolve.test.ts\nsrc/audit/index.ts\nsrc/tokens/index.ts", 90);

  const rg = s.use("Bash", { command: "rg -n \"P95_BUDGET_MS\" src", description: "Find the budget constant" });
  s.respond([rg.block], { outputTokens: 98, gaps: [620] });
  s.result(rg, "/bin/sh: rg: command not found\n\nExit code 127", 120, { isError: true });

  const cacheEdit = edit(s, `${WS}/src/probe/cache.ts`, "/** Where answers live, keyed by probe. Writes are fire-and-forget. */", "/** Where answers live, keyed by probe. Writes are awaited by the caller. */",
    patch(11, [" ", "/**"], ["/** Where answers live, keyed by probe. Writes are fire-and-forget. */"], ["/** Where answers live, keyed by probe. Writes are awaited by the caller. */"], ["export class Cache {"]), 700);
  s.respond([cacheEdit.call.block], { outputTokens: 260, gaps: [900] });
  cacheEdit.finish();

  const readEvidence = s.use("Read", { file_path: `${WS}/src/probe/evidence.ts` });
  s.respond([readEvidence.block], { outputTokens: 102, gaps: [580] });
  s.result(readEvidence, "     1\t/** One thing a probe saw while it ran, with the moment it saw it. */", 130);

  const removed = ["  const answer = await probe.run({ evidence, timeout: 14_000 });", "  cache.write(probe.key, answer);", "  return answer;"];
  const added = [
    "  const answer = await probe.run({ evidence, timeout: 14_000 });",
    "",
    "  // The write is awaited: a second caller must never race the first into a",
    "  // duplicate run, and the p95 budget counts the write.",
    "  const started = performance.now();",
    "  try {",
    "    await cache.write(probe.key, answer);",
    "  } finally {",
    "    evidence.mark(\"write\", performance.now() - started);",
    "  }",
    "",
    "  // Evidence is flushed with the answer so a cached hit carries it.",
    "  evidence.seal();",
    "  return answer;",
  ];
  if (added.length !== 14 || removed.length !== 3) throw new Error("the Edit patch must be +14 -3");
  const resolveEdit = edit(s, `${WS}/src/probe/resolve.ts`, removed.join("\n"), added.join("\n"),
    patch(43, ["  const evidence = new Evidence(probe.id);"], removed, added, ["}", "", "export const P95_BUDGET_MS = 2; // measured: 1.8"]), 1100);
  s.respond([
    { type: "text", text: "The write is awaited now, and the evidence is sealed with the answer. Running the probe suite." },
    resolveEdit.call.block,
  ], { outputTokens: 640, gaps: [700, 40] });
  resolveEdit.finish();
  todo(plan("completed", "in_progress", "pending"), 500);

  const test = s.use("Bash", { command: "pnpm test probe", description: "Run the probe tests" });
  s.respond([test.block], { outputTokens: 118, gaps: [520] });
  s.result(test, "✓ resolve › returns the cached answer (3 ms)\n✓ resolve › re-runs a stale probe and keeps evidence (41 ms)\n✓ cache › write is awaited before return (2 ms)\nTests  14 passed, 14 total", 2400, {
    toolUseResult: { stdout: "Tests  14 passed, 14 total", stderr: "", interrupted: false, isImage: false, noOutputExpected: false },
  });
  todo(plan("completed", "completed", "in_progress"), 450);

  // The last response: prose, then the audit, which has not answered yet. Its
  // 1,260 output tokens over the 1.05 s since the previous result make ~1.2k tok/s.
  const audit = s.use("Bash", { command: "pnpm sl-audit", description: "Run the audit" });
  s.respond([
    { type: "text", text: "All 14 tests pass and the p95 holds. Running the audit for the last finding." },
    audit.block,
  ], { outputTokens: 1260, gaps: [1020, 30] });

  if (s.tools !== 14) throw new Error(`refactor: ${s.tools} tools, want 14`);
  s.write("refactor-the-audit.jsonl");
}

/* ── 2/3/4. Finished and long-running sessions, built from a recipe ─────────── */

/** A tool-call recipe: what a session of this kind reads, searches, edits and runs. */
function recipe(files, commands) {
  return (s, i) => {
    const f = files[i % files.length];
    switch (i % 8) {
      case 0: { const c = s.use("Read", { file_path: f, offset: 1, limit: 80 }); return { c, out: `     1\t/* ${f.split("/").pop()} */`, ms: 160 }; }
      case 1: { const c = s.use("Grep", { pattern: ["--sl-surface", "var\\(--", "color-scheme", "prefers-color"][i % 4], path: f.slice(0, f.lastIndexOf("/")), output_mode: "files_with_matches" }); return { c, out: files.slice(0, 3).join("\n"), ms: 210 }; }
      case 2: { const c = s.use("Glob", { pattern: "**/*.{css,ts}", path: f.slice(0, f.lastIndexOf("/")) }); return { c, out: files.join("\n"), ms: 80 }; }
      case 3: { const c = s.use("Read", { file_path: f }); return { c, out: `     1\t/* ${f.split("/").pop()} */`, ms: 140 }; }
      case 4: {
        const e = edit(s, f, `  --sl-surface: #fff${i};`, `  --sl-surface: var(--sl-canvas);`, patch(10 + i % 30, ["  color-scheme: light;"], [`  --sl-surface: #fff${i};`], ["  --sl-surface: var(--sl-canvas);", "  --sl-edge: var(--sl-line);"], ["}"]), 600 + (i % 5) * 90);
        return { edit: e };
      }
      case 5: { const cmd = commands[i % commands.length]; const c = s.use("Bash", { command: cmd, description: "Run a check" }); return { c, out: "ok", ms: 900 + (i % 6) * 310, toolUseResult: { stdout: "ok", stderr: "", interrupted: false, isImage: false, noOutputExpected: false } }; }
      case 6: { const c = s.use("Read", { file_path: f, offset: 40, limit: 60 }); return { c, out: `    40\t/* ${f.split("/").pop()} */`, ms: 150 }; }
      default: { const c = s.use("Grep", { pattern: "TODO|FIXME", path: f.slice(0, f.lastIndexOf("/")), output_mode: "count" }); return { c, out: "0", ms: 120 }; }
    }
  };
}

/**
 * A session of `tools` tool calls in turns of about six, ending on prose
 * (`openTail: false`) or on a call with no result yet (`openTail: true`).
 */
function longSession(opts, tools, openTail) {
  const s = new Session(opts);
  s.prompt(opts.prompt);
  s.respond([{ type: "text", text: opts.opening }], { outputTokens: 70, gaps: [900], stop: "end_turn" });
  const step = recipe(opts.files, opts.commands);
  for (let i = 0; s.tools < tools; i++) {
    const last = s.tools === tools - 1;
    const r = step(s, i);
    const call = r.edit ? r.edit.call : r.c;
    const blocks = i % 6 === 0 ? [{ type: "text", text: opts.notes[(i / 6) % opts.notes.length | 0] }, call.block] : [call.block];
    s.respond(blocks, { outputTokens: 90 + (i % 9) * 35, gaps: [600 + (i % 5) * 140, 40] });
    if (openTail && last) break;
    if (r.edit) r.edit.finish();
    else s.result(r.c, r.out, r.ms, r.toolUseResult ? { toolUseResult: r.toolUseResult } : {});
  }
  if (!openTail) {
    s.respond([{ type: "text", text: opts.closing }], { outputTokens: 180, gaps: [1100], stop: "end_turn" });
    s.meta({ type: "last-prompt", lastPrompt: opts.prompt, leafUuid: s.parent });
    s.meta({ type: "ai-title", aiTitle: opts.title });
  }
  if (s.tools !== tools) throw new Error(`${opts.title}: ${s.tools} tools, want ${tools}`);
  return s;
}

const probeFiles = ["{{WS}}/sondalab.tokens.json", "{{WS}}/src/tokens/index.ts", "{{WS}}/src/audit/index.ts", "{{WS}}/src/probe/cache.ts", "{{WS}}/src/probe/evidence.ts"];
const siteFiles = ["{{SITE}}/src/styles/tokens.css", "{{SITE}}/src/styles/prism.css", "{{SITE}}/src/components/hero.tsx", "{{SITE}}/src/components/nav.tsx", "{{SITE}}/src/pages/index.tsx", "{{SITE}}/src/pages/pricing.tsx"];

longSession({
  id: "c41d9e07-52aa-4b18-8e3f-7d60b2a14c95", dir: "{{WS}}", branch: "main", start: "2026-10-09T12:05:10.000Z", permissionMode: "default",
  title: "Prism light theme", prompt: "Give the prism palette a light theme that holds the contrast floor.",
  opening: "I'll derive the light roles from the dark ones and check each pair against the floor.",
  notes: ["The dark roles map cleanly; the edge needs a darker step.", "Surface and canvas now differ by one step.", "Two pairs fall under 4.5:1, adjusting them.", "The audit agrees with the measured ratios."],
  closing: "The light theme is in sondalab.tokens.json and every text pair clears 4.5:1; the edge clears 3:1.",
  files: probeFiles, commands: ["pnpm sl-audit", "pnpm test probe", "git diff --stat"],
}, 212, false).write("prism-light-theme.jsonl");

longSession({
  id: "e7b3a2f9-1d46-4c80-b5a7-93e1c0d82f64", dir: "{{WS}}", branch: "main", start: "2026-10-09T10:20:40.000Z", permissionMode: "default",
  title: "Edge in shade", prompt: "The edge colour disappears in shade; find out why and fix it.",
  opening: "I'll read the edge role in both themes and measure it against the surface.",
  notes: ["The edge is 2.1:1 against the surface in shade.", "Raising the edge one step fixes the shade case.", "Checking the light theme did not regress."],
  closing: "The edge now clears 3:1 in shade and in light.",
  files: probeFiles, commands: ["pnpm sl-audit", "pnpm test probe"],
}, 58, false).write("edge-in-shade.jsonl");

longSession({
  id: "5a90f6d2-8c3e-4f17-a2b4-61d7e3c9b058", dir: "{{SITE}}", branch: "main", start: "2026-10-09T11:40:00.000Z", permissionMode: "auto",
  title: "Marketing site rebuild", prompt: "Rebuild the marketing site on the prism tokens, page by page, starting with the home page.",
  opening: "I'll start with the tokens the pages share, then work through the home page and pricing.",
  notes: ["Tokens first: every page reads them.", "The hero uses raw colours; moving it to roles.", "Nav next, it shares the surface role.", "Pricing has the same pattern."],
  closing: "",
  files: siteFiles, commands: ["pnpm build", "pnpm lint", "pnpm test"],
}, 198, true).write("prism-site-rebuild.jsonl");
