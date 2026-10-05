import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/** Where everything for one capture run lives. Each path is absolute. */
export interface PreparedRun {
  /** Root of the run; nothing outside it is written. */
  readonly root: string;
  /** The fixture workspace; its leaf is `probe-engine`, as in the demo. */
  readonly workspace: string;
  /** Fixture HOME: shell rc files, `.gitconfig`, an empty `.claude/`. */
  readonly home: string;
  /** Directory put first on PATH; holds the `claude` stub. */
  readonly bin: string;
  /** THEIA_CONFIG_DIR, seeded with `settings.json`. */
  readonly configDir: string;
  /** Passed as `--electronUserData`. */
  readonly userData: string;
  /** Where the fixture extension writes its acknowledgements. */
  readonly ackDir: string;
}

export type Theme = "dark" | "light";
export type Os = "linux" | "mac";

const FIXTURE = path.join(__dirname, "fixtures", "probe-engine");

/** A fixed identity and clock, so every run builds byte-identical commits. */
const AUTHOR = { name: "Mae Brook", email: "fixture@example.invalid" };

/**
 * The fixture's history. `files` holds the content each commit gives a path,
 * as a transform of the working-tree file in the fixture, so the repository
 * stores one copy of each file. Paths not listed keep their working-tree
 * content. evidence.ts is never committed: the demo shows it untracked (U).
 */
interface Commit {
  readonly message: string;
  readonly date: string;
  readonly files: Record<string, (text: string) => string>;
}

const OLD_TIMEOUT = (text: string): string => replaceOnce(text, "timeout: 14_000", "timeout: 12_000");
const OLD_TTL = (text: string): string => replaceOnce(text, '"probe-ttl-days": 14', '"probe-ttl-days": 7');

const PUSHED: Commit = {
  message: "probe: first resolver, cache and audit",
  date: "2026-09-28T09:00:00Z",
  files: {
    "src/probe/resolve.ts": OLD_TIMEOUT,
    "sondalab.tokens.json": OLD_TTL,
    "src/probe/cache.ts": (text) => replaceOnce(text, "Writes are awaited by the caller.", "Writes are fire-and-forget."),
    "src/probe/resolve.test.ts": (text) => replaceOnce(text, "re-runs a stale probe and keeps evidence", "re-runs a stale probe"),
  },
};

/** The two local commits that put `main` at ↑2 over its remote. */
const LOCAL: readonly Commit[] = [
  {
    message: "cache: document who awaits a write",
    date: "2026-09-29T10:30:00Z",
    files: {
      "src/probe/resolve.ts": OLD_TIMEOUT,
      "sondalab.tokens.json": OLD_TTL,
      "src/probe/resolve.test.ts": (text) => replaceOnce(text, "re-runs a stale probe and keeps evidence", "re-runs a stale probe"),
    },
  },
  {
    message: "test: a stale probe keeps its evidence",
    date: "2026-09-30T16:45:00Z",
    files: {
      "src/probe/resolve.ts": OLD_TIMEOUT,
      "sondalab.tokens.json": OLD_TTL,
    },
  },
];

/** Paths spexr writes into a workspace at runtime; kept out of git status. */
const RUNTIME_PATHS = [".spexr/", "docs/"];

/**
 * Build a fresh run directory for one theme.
 *
 * Copies the fixture, builds its git state (branch `main` two commits ahead of
 * a bare remote, `resolve.ts` and `sondalab.tokens.json` modified, `evidence.ts`
 * untracked), writes the fixture HOME with a `claude` stub first on PATH, and
 * seeds Theia's user settings. Anything left from an earlier run is removed.
 */
export function prepareRun(root: string, theme: Theme, os: Os): PreparedRun {
  fs.rmSync(root, { recursive: true, force: true });
  const run: PreparedRun = {
    root,
    workspace: path.join(root, "ws", "probe-engine"),
    home: path.join(root, "home"),
    bin: path.join(root, "bin"),
    configDir: path.join(root, "theia"),
    userData: path.join(root, "ud"),
    ackDir: path.join(root, "ack"),
  };
  for (const dir of [run.workspace, run.home, run.bin, run.configDir, run.userData, run.ackDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  writeHome(run);
  writeClaudeStub(run.bin);
  buildRepository(run);
  seedSettings(run.configDir, theme, os);
  return run;
}

function buildRepository(run: PreparedRun): void {
  const remote = path.join(run.root, "remote", "probe-engine.git");
  fs.mkdirSync(remote, { recursive: true });
  git(run, remote, null, ["init", "--bare", "--initial-branch=main"]);

  const ws = run.workspace;
  git(run, ws, null, ["init", "--initial-branch=main"]);
  fs.appendFileSync(path.join(ws, ".git", "info", "exclude"), RUNTIME_PATHS.join("\n") + "\n");
  git(run, ws, null, ["remote", "add", "origin", remote]);

  commit(run, PUSHED);
  git(run, ws, null, ["push", "--quiet", "--set-upstream", "origin", "main"]);
  for (const c of LOCAL) commit(run, c);

  // The working tree: every file as the fixture holds it, evidence.ts included.
  fs.cpSync(FIXTURE, ws, { recursive: true });
}

/** Write the commit's view of every tracked file, then commit at its fixed date. */
function commit(run: PreparedRun, c: Commit): void {
  for (const rel of trackedFiles()) {
    const text = fs.readFileSync(path.join(FIXTURE, rel), "utf8");
    const transform = c.files[rel];
    const target = path.join(run.workspace, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, transform ? transform(text) : text);
  }
  git(run, run.workspace, c.date, ["add", "--all"]);
  git(run, run.workspace, c.date, ["commit", "--quiet", "--message", c.message]);
}

/** Every fixture file except the one the demo shows untracked. */
function trackedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(FIXTURE, abs).split(path.sep).join("/"));
    }
  };
  walk(FIXTURE);
  return out.filter((rel) => rel !== "src/probe/evidence.ts").sort();
}

function git(run: PreparedRun, cwd: string, date: string | null, args: string[]): void {
  execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      PATH: process.env.PATH ?? "",
      HOME: run.home,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: AUTHOR.name,
      GIT_AUTHOR_EMAIL: AUTHOR.email,
      GIT_COMMITTER_NAME: AUTHOR.name,
      GIT_COMMITTER_EMAIL: AUTHOR.email,
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      TZ: "UTC",
    },
  });
}

/**
 * The fixture HOME. Both shells get the stub's directory first on PATH, set in
 * the rc file each one reads last, because macOS's /etc/zprofile reorders PATH
 * (path_helper) after anything inherited. The prompt is the demo's.
 */
function writeHome(run: PreparedRun): void {
  const prompt = "~/probe-engine on main › ";
  const posix = [
    `export PATH="${run.bin}:$PATH"`,
    "export HISTFILE=/dev/null",
    "unset PROMPT_COMMAND",
    `PS1='${prompt}'`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(run.home, ".bashrc"), posix);
  fs.writeFileSync(path.join(run.home, ".bash_profile"), '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n');
  fs.writeFileSync(
    path.join(run.home, ".zshrc"),
    [`export PATH="${run.bin}:$PATH"`, "export HISTFILE=/dev/null", `PROMPT='${prompt}'`, "RPROMPT=''", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(run.home, ".gitconfig"),
    [
      "[user]",
      `\tname = ${AUTHOR.name}`,
      `\temail = ${AUTHOR.email}`,
      "[init]",
      "\tdefaultBranch = main",
      "[safe]",
      "\tdirectory = *",
      "",
    ].join("\n"),
  );
  // Dark Factory reads sessions from $HOME/.claude*; an empty one shows none.
  fs.mkdirSync(path.join(run.home, ".claude", "projects"), { recursive: true });
  fs.mkdirSync(path.join(run.home, ".config"), { recursive: true });
}

/** A stand-in for the Claude CLI: prints one line and waits, so the agent terminal is still. */
function writeClaudeStub(bin: string): void {
  const stub = path.join(bin, "claude");
  fs.writeFileSync(
    stub,
    ["#!/bin/sh", "# tests/visual fixture: not the Claude CLI.", "printf 'claude (visual fixture stub)\\n'", "while :; do sleep 3600; done", ""].join("\n"),
  );
  fs.chmodSync(stub, 0o755);
}

/**
 * Theia's user settings for the run. Every key is about determinism or about
 * reaching the scene, not about how spexr looks:
 * - the theme, and on Linux the native frame Theia would pick anyway, so it
 *   never asks to restart;
 * - no trust prompt, no fetch, no local model, no launch-profile scan;
 * - a solid caret, so two captures of the same scene are the same picture;
 * - no TypeScript diagnostics: the fixture imports a `./types` that the demo
 *   never shows, and a red squiggle there is not the demo's warning;
 * - the folders spexr writes into a workspace at runtime stay out of the tree.
 */
function seedSettings(configDir: string, theme: Theme, os: Os): void {
  const settings: Record<string, unknown> = {
    "workbench.colorTheme": theme,
    "security.workspace.trust.enabled": false,
    "spexr.git.autofetch": false,
    "spexr.search.aiDescriptions.enabled": false,
    "spexr.claude.launchProfilesDetected": true,
    "editor.cursorBlinking": "solid",
    "terminal.integrated.cursorBlinking": false,
    "typescript.validate.enable": false,
    "files.exclude": {
      "**/.git": true,
      "**/.svn": true,
      "**/.hg": true,
      "**/CVS": true,
      "**/.DS_Store": true,
      ".spexr": true,
      docs: true,
    },
  };
  if (os === "linux") settings["window.titleBarStyle"] = "native";
  fs.writeFileSync(path.join(configDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n");
}

/** Replace exactly one occurrence, or fail: a fixture edit must not silently stop applying. */
function replaceOnce(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) {
    throw new Error(`fixture history: expected exactly one "${from}"`);
  }
  return text.slice(0, at) + to + text.slice(at + from.length);
}
