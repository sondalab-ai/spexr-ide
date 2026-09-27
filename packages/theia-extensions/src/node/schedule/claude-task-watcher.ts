import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFollowChunk, type FollowCursor } from "../darkfactory/follow-reader.js";
import { projectsDirOf } from "../darkfactory/config-dirs.js";
import { lastTurn, SETTLE_MS, type StateEntry } from "../darkfactory/session-state.js";
import { TurnTracker, finalReply, isPrompt, type TurnSignal } from "./turn-tracker.js";

/**
 * No transcript this long after launch: Claude is most likely at a startup
 * dialog (folder trust, bypass-mode confirmation), which it shows before it
 * writes anything (probe, 2026-09-27). The task then needs the operator.
 */
export const CLAUDE_STARTUP_PROMPT_MS = 8_000;
const TICK_MS = 1_000;
const FIRST_READ_BYTES = 4 * 1024 * 1024;
/** Entries kept in memory: enough for any one turn, bounded for long loops. */
const KEEP_ENTRIES = 2_000;

export type WatchEvent =
  | { type: "session-found"; sessionId: string }
  | { type: "session-missing" }
  | { type: "turn-ended"; reply: string }
  | Exclude<TurnSignal, { type: "turn-ended" }>;

/** A running task watch. */
export interface TaskWatch {
  stop(): void;
  /**
   * Call just before pasting a prompt. The next turn end counts once a prompt
   * newer than this call shows up — even if the agent was never seen working
   * (a reply that lands between two reads). The reply already on screen never
   * counts again.
   */
  arm(): void;
}

/** The account dir as a path: "" is the default account, `~/…` is home-relative. */
function accountDir(configDir: string, home: string): string {
  if (!configDir) return join(home, ".claude");
  if (configDir === "~" || configDir === "$HOME") return home;
  if (configDir.startsWith("~/")) return join(home, configDir.slice(2));
  if (configDir.startsWith("$HOME/")) return join(home, configDir.slice(6));
  return configDir;
}

/** `<account>/projects/*\/<sessionId>.jsonl`, or undefined while it does not exist yet. */
export async function findClaudeTranscript(
  configDir: string,
  sessionId: string,
  home: string = homedir(),
): Promise<string | undefined> {
  const projects = projectsDirOf(accountDir(configDir, home));
  let dirs: string[];
  try {
    dirs = await readdir(projects);
  } catch {
    return undefined;
  }
  for (const d of dirs) {
    const candidate = join(projects, d, `${sessionId}.jsonl`);
    if (await stat(candidate).then((s) => s.isFile(), () => false)) return candidate;
  }
  return undefined;
}

export interface ClaudeWatchDeps {
  now(): number;
  /** Run `fn` every tick; returns a stop function. Ticks never overlap (the watcher awaits). */
  every(fn: () => Promise<void>): () => void;
  find(configDir: string, sessionId: string): Promise<string | undefined>;
  read(path: string, cursor: FollowCursor | undefined, tailBytes: number): ReturnType<typeof readFollowChunk>;
}

/** A ticker that runs `fn` every `ms`, skipping a tick while the previous one is still running. */
export function everyMs(ms: number): (fn: () => Promise<void>) => () => void {
  return (fn) => {
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void fn().finally(() => (busy = false));
    }, ms);
    timer.unref?.();
    return () => clearInterval(timer);
  };
}

export const defaultClaudeWatchDeps: ClaudeWatchDeps = {
  now: () => Date.now(),
  every: everyMs(TICK_MS),
  find: (configDir, sessionId) => findClaudeTranscript(configDir, sessionId),
  read: readFollowChunk,
};

/**
 * Follow one scheduled Claude session: wait for its transcript (reporting
 * needs-you after CLAUDE_STARTUP_PROMPT_MS — the pty exiting is what fails the
 * task), then read what it gains every second and report turn transitions.
 */
export function watchClaudeTask(
  req: { sessionId: string; configDir: string; permissionMode?: string },
  deps: ClaudeWatchDeps,
  listener: (e: WatchEvent) => void,
): TaskWatch {
  const startedAt = deps.now();
  const tracker = new TurnTracker({
    ...(req.permissionMode !== undefined ? { permissionMode: req.permissionMode } : {}),
    settleMs: SETTLE_MS,
    armed: true,
  });
  let path: string | undefined;
  let cursor: FollowCursor | undefined;
  let entries: StateEntry[] = [];
  let waitingAtStartup = false;
  // Counted as lines arrive: `entries` is trimmed to KEEP_ENTRIES, so its
  // length cannot serve as the baseline arm() compares against.
  let promptsSeen = 0;
  let armAfter: number | undefined;
  const stop = deps.every(async () => {
    if (!path) {
      path = await deps.find(req.configDir, req.sessionId);
      if (!path) {
        if (!waitingAtStartup && deps.now() - startedAt >= CLAUDE_STARTUP_PROMPT_MS) {
          waitingAtStartup = true;
          listener({ type: "needs-you" });
        }
        return;
      }
      listener({ type: "session-found", sessionId: req.sessionId });
      if (waitingAtStartup) listener({ type: "resumed-working" });
    }
    const chunk = await deps.read(path, cursor, FIRST_READ_BYTES);
    cursor = chunk.cursor;
    for (const line of chunk.lines) {
      let entry: StateEntry;
      try {
        entry = JSON.parse(line) as StateEntry;
      } catch {
        continue; // a malformed line is dropped; readFollowChunk already holds back torn ones
      }
      entries.push(entry);
      if (entry && isPrompt(entry)) promptsSeen++;
    }
    if (entries.length > KEEP_ENTRIES) entries = entries.slice(-KEEP_ENTRIES);
    if (armAfter !== undefined && promptsSeen > armAfter) {
      tracker.arm();
      armAfter = undefined;
    }
    for (const signal of tracker.update(lastTurn(entries), deps.now())) {
      listener(signal.type === "turn-ended" ? { type: "turn-ended", reply: finalReply(entries) } : signal);
    }
  });
  return {
    stop,
    arm: () => {
      armAfter = promptsSeen;
    },
  };
}
