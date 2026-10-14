import fs from "fs";
import path from "path";
import { git, seedSettings, writeClaudeStub, writeHome } from "./prepare";

/**
 * The marketing capture's run: `ledgerline` (the workspace), two more
 * projects for the Darkfactory wall, and the fixture HOME. Each path is
 * absolute. Shaped like PreparedRun where launch() and the stubs read it.
 */
export interface ShowcaseRun {
  readonly root: string;
  readonly workspace: string;
  readonly atlas: string;
  readonly notes: string;
  readonly home: string;
  readonly bin: string;
  readonly configDir: string;
  readonly userData: string;
  readonly ackDir: string;
  /** Served on localhost:4317 for the card browser. */
  readonly www: string;
}

/** One seeded session, from fixtures/showcase-sessions/manifest.json. */
interface ShowcaseSession {
  readonly file: string;
  readonly project: "ws" | "atlas" | "notes";
  readonly sessionId: string;
  readonly name: string;
  /** How long ago the session was last written; 0 for a live agent. */
  readonly ageMinutes: number;
  readonly live: boolean;
  readonly harness: "claude" | "opencode";
}

const FIXTURES = path.join(__dirname, "fixtures");
const WORKSPACE = path.join(FIXTURES, "showcase");
const SESSIONS = path.join(FIXTURES, "showcase-sessions");
const OPENCODE_DATA = path.join(".local", "share", "opencode-fixture");

function sessions(): ShowcaseSession[] {
  return JSON.parse(fs.readFileSync(path.join(SESSIONS, "manifest.json"), "utf8")) as ShowcaseSession[];
}

function projectDir(run: ShowcaseRun, p: ShowcaseSession["project"]): string {
  return fs.realpathSync(p === "ws" ? run.workspace : p === "atlas" ? run.atlas : run.notes);
}

/** Where Claude Code keeps a project's transcripts: the cwd with every non-alphanumeric turned into `-`. */
function transcriptPath(run: ShowcaseRun, s: ShowcaseSession): string {
  return path.join(run.home, ".claude", "projects", projectDir(run, s.project).replace(/[^a-zA-Z0-9]/g, "-"), `${s.sessionId}.jsonl`);
}

/**
 * Build a fresh showcase run. The workspace is a git repository on branch
 * `reconcile-window` with one staged change (for the commit message scene);
 * the HOME holds the transcripts, session and project names, the opencode
 * stub's data and a plant schedule. Anything left from an earlier run is
 * removed.
 */
export function prepareShowcase(root: string): ShowcaseRun {
  fs.rmSync(root, { recursive: true, force: true });
  const run: ShowcaseRun = {
    root,
    workspace: path.join(root, "ws", "ledgerline"),
    atlas: path.join(root, "ws", "atlas-api"),
    notes: path.join(root, "ws", "field-notes"),
    home: path.join(root, "home"),
    bin: path.join(root, "bin"),
    configDir: path.join(root, "theia"),
    userData: path.join(root, "ud"),
    ackDir: path.join(root, "ack"),
    www: path.join(root, "www"),
  };
  for (const dir of [run.workspace, run.atlas, run.notes, run.home, run.bin, run.configDir, run.userData, run.ackDir, run.www]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  writeHome(run, "~/ledgerline on reconcile-window › ");
  writeClaudeStub(run.bin);
  fs.copyFileSync(path.join(FIXTURES, "bin", "opencode"), path.join(run.bin, "opencode"));
  fs.chmodSync(path.join(run.bin, "opencode"), 0o755);

  buildLedgerline(run);
  buildSmallProject(run, run.atlas, "atlas-api", "The public API for account data.");
  buildSmallProject(run, run.notes, "field-notes", "A notes app that works offline.");
  seedSessions(run);
  seedSchedule(run);
  // The active expert is a folder-scoped preference; `.spexr/` is git-ignored in this repo, so it is written here.
  fs.mkdirSync(path.join(run.workspace, ".spexr"), { recursive: true });
  fs.writeFileSync(path.join(run.workspace, ".spexr", "settings.json"), JSON.stringify({ "spexr.experts.activeId": "software-engineering" }, null, 2) + "\n");
  seedSettings(run.configDir, "dark", {
    "spexr.search.aiDescriptions.enabled": true,
    "files.exclude": { "**/.git": true, "**/.DS_Store": true, ".spexr": true },
  });
  fs.copyFileSync(path.join(FIXTURES, "showcase-www", "report.html"), path.join(run.www, "report.html"));
  touchShowcase(run);
  return run;
}

/** Three commits on `main` (two traced to specs), then a branch with one staged and one unstaged change. */
function buildLedgerline(run: ShowcaseRun): void {
  const ws = run.workspace;
  fs.cpSync(WORKSPACE, ws, { recursive: true });
  git(run, ws, null, ["init", "--initial-branch=main"]);
  fs.appendFileSync(path.join(ws, ".git", "info", "exclude"), ".spexr/\n");
  const commit = (paths: string[], message: string, date: string): void => {
    git(run, ws, date, ["add", "--", ...paths]);
    git(run, ws, date, ["commit", "--quiet", "--message", message]);
  };
  commit(["package.json", "tsconfig.json", "README.md", "src/ledger", "docs/memory", "docs/agents"], "ledgerline: a JSON ledger and the project notes", "2026-09-22T09:00:00Z");
  commit(["src/import/csv.ts", "src/import/csv.test.ts", "src/cli.ts", "docs/specs/0001-csv-import.md", "docs/specs/.context/0001-csv-import"], "import: read bank CSV statements\n\nSpec: 0001-csv-import", "2026-09-25T14:30:00Z");
  commit(["."], "dates: read en-GB and en-US statement dates\n\nSpec: 0002-date-locales", "2026-10-02T11:15:00Z");
  git(run, ws, null, ["checkout", "--quiet", "-b", "reconcile-window"]);

  const match = path.join(ws, "src", "reconcile", "match.ts");
  fs.writeFileSync(
    match,
    fs.readFileSync(match, "utf8") +
      [
        "",
        "/** The candidate dated closest to the row; the first one wins a tie (spec 0003, AC-3). */",
        "export function closestDate(row: Row, candidates: readonly Entry[]): Entry | undefined {",
        "  let best: Entry | undefined;",
        "  for (const e of candidates) {",
        "    if (!best || daysApart(e.date, row.date) < daysApart(best.date, row.date)) best = e;",
        "  }",
        "  return best;",
        "}",
        "",
      ].join("\n"),
  );
  git(run, ws, null, ["add", "src/reconcile/match.ts"]);
  const test = path.join(ws, "src", "reconcile", "match.test.ts");
  fs.appendFileSync(test, '\ntest("month-end rows match entries booked in the next month", () => {\n  assert.ok(true);\n});\n');
}

function buildSmallProject(run: ShowcaseRun, dir: string, name: string, about: string): void {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, private: true, version: "1.0.0" }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "README.md"), `# ${name}\n\n${about}\n`);
  git(run, dir, null, ["init", "--initial-branch=main"]);
  git(run, dir, "2026-10-01T10:00:00Z", ["add", "--all"]);
  git(run, dir, "2026-10-01T10:00:00Z", ["commit", "--quiet", "--message", `${name}: first commit`]);
}

function substitute(run: ShowcaseRun, text: string): string {
  return text
    .split("{{WS}}").join(projectDir(run, "ws"))
    .split("{{ATLAS}}").join(projectDir(run, "atlas"))
    .split("{{NOTES}}").join(projectDir(run, "notes"));
}

/** Transcripts, the names the user gave them and the three projects, and the opencode export. */
function seedSessions(run: ShowcaseRun): void {
  const names: Record<string, string> = {};
  for (const s of sessions()) {
    const text = substitute(run, fs.readFileSync(path.join(SESSIONS, s.file), "utf8"));
    names[s.sessionId] = s.name;
    if (s.harness === "opencode") {
      const dir = path.join(run.home, OPENCODE_DATA);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${s.sessionId}.json`), text);
      continue;
    }
    const target = transcriptPath(run, s);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  const spexr = path.join(run.home, ".spexr");
  fs.mkdirSync(spexr, { recursive: true });
  fs.writeFileSync(path.join(spexr, "session-names.json"), JSON.stringify(names) + "\n");
  fs.writeFileSync(
    path.join(spexr, "project-names.json"),
    JSON.stringify({ [projectDir(run, "ws")]: "ledgerline", [projectDir(run, "atlas")]: "atlas-api", [projectDir(run, "notes")]: "field-notes" }, null, 2) + "\n",
  );
}

/** One plant schedule: write the spec, implement it in a loop until the tests pass, review. */
function seedSchedule(run: ShowcaseRun): void {
  const project = projectDir(run, "ws");
  const schedule = {
    version: 1,
    runs: {},
    schedules: [
      {
        id: "ship-reconcile-window",
        name: "Ship reconcile window",
        tasks: [
          { id: "spec", name: "Close the spec", needs: [], project, workspace: { kind: "folder" }, harness: "claude", permissionMode: "acceptEdits", prompt: "Answer the open clarifications in spec 0003 and mark it ready." },
          {
            id: "impl", name: "Implement", needs: ["spec"], project, workspace: { kind: "worktree" }, harness: "claude",
            prompt: "Implement spec 0003 task by task. Notes from the spec step: {{spec.reply}}",
            loop: { stopCriteria: "All tests pass and every AC has a test", followUp: "Keep going with the next open task.", maxIterations: 5, check: "node --test" },
          },
          { id: "review", name: "Review", needs: ["impl"], project, workspace: { kind: "sameAs", task: "impl" }, harness: "claude", model: "claude-opus-5-5", prompt: "Review the change in {{impl.workspace}} against spec 0003." },
        ],
      },
    ],
  };
  fs.writeFileSync(path.join(run.home, ".spexr", "schedules.json"), JSON.stringify(schedule, null, 2) + "\n");
}

/**
 * Give each session the age the manifest says, counted from now. A live
 * agent counts as running only while its transcript is newer than ten
 * minutes, so the capture calls this again right before the wall. The
 * opencode row's `time_updated` is its age, so its `opencode db` answer is
 * rewritten here too.
 */
export function touchShowcase(run: ShowcaseRun, now: number = Date.now()): void {
  const rows: unknown[] = [];
  for (const s of sessions()) {
    const at = now - s.ageMinutes * 60_000;
    if (s.harness === "opencode") {
      rows.push({ id: s.sessionId, directory: projectDir(run, s.project), parent_id: null, title: s.name, agent: "build", model: "anthropic/claude-sonnet-5-5", time_created: at - 40 * 60_000, time_updated: at });
      continue;
    }
    fs.utimesSync(transcriptPath(run, s), new Date(at), new Date(at));
  }
  fs.writeFileSync(path.join(run.home, OPENCODE_DATA, "sessions.json"), JSON.stringify(rows) + "\n");
}

/** The directories the live agents work in, as realpaths (lsof reports the resolved one). */
export function showcaseLiveDirs(run: ShowcaseRun): string[] {
  return [...new Set(sessions().filter((s) => s.live).map((s) => s.project))].map((p) => projectDir(run, p));
}
