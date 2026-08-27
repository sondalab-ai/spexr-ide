import { join } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { configDirs as defaultConfigDirs, projectsDirOf } from "../../node/darkfactory/config-dirs.js";
import { parseTranscript } from "../../node/darkfactory/transcript-parser.js";
import { readBoundedLines } from "../../node/darkfactory/bounded-read.js";
import type { HarnessAdapter, HarnessSessionRef, ParsedTranscript, FollowHandle } from "./harness-types.js";
import { claudeCore } from "./claude-harness-core.js";
import { once } from "./once.js";

/** One Claude transcript file discovered on disk; `readLines` is lazy. */
export interface TranscriptRef {
  sessionId: string;
  transcriptPath: string;
  /** Config dir that owns this session (for `claude --resume`). */
  configDir: string;
  mtimeMs: number;
  readLines(): Promise<string[]>;
}

/** Walk every Claude config dir's `projects/` for `.jsonl` transcripts. */
export async function scanClaudeTranscripts(configDirs: string[] = defaultConfigDirs()): Promise<TranscriptRef[]> {
  const refs: TranscriptRef[] = [];
  for (const configDir of configDirs) {
    const projectsDir = projectsDirOf(configDir);
    let projectDirs: string[];
    try {
      projectDirs = await readdir(projectsDir);
    } catch {
      continue; // this config dir has no projects
    }
    for (const dir of projectDirs) {
      const full = join(projectsDir, dir);
      let files: string[];
      try {
        files = await readdir(full);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const transcriptPath = join(full, f);
        let mtimeMs: number;
        try {
          mtimeMs = (await stat(transcriptPath)).mtimeMs;
        } catch {
          continue;
        }
        refs.push({
          sessionId: f.replace(/\.jsonl$/, ""),
          transcriptPath,
          configDir,
          mtimeMs,
          readLines: () => readBoundedLines(transcriptPath),
        });
      }
    }
  }
  return refs;
}

/** Loosely-typed Claude transcript entry (only `message` is read downstream). */
export interface ClaudeEntry {
  isMeta?: boolean;
  message?: { role?: string; content?: unknown };
}

function parseLine(line: string): ClaudeEntry | undefined {
  try {
    return JSON.parse(line) as ClaudeEntry;
  } catch {
    return undefined;
  }
}

/**
 * The Claude Code harness. Delegates to the existing Claude helpers so behavior
 * is identical to the pre-abstraction code; this object is the routing point
 * that later slices sit a second harness beside.
 */
export const claudeHarness: HarnessAdapter = {
  ...claudeCore,

  async listSessions(): Promise<HarnessSessionRef[]> {
    const refs = await scanClaudeTranscripts();
    return refs.map((r) => ({
      sessionId: r.sessionId,
      projectPath: "", // resolved from the transcript's cwd at parse time (as today)
      mtimeMs: r.mtimeMs,
      loadEntries: once(async () => {
        const lines = await r.readLines();
        return lines.map(parseLine).filter((e): e is ClaudeEntry => !!e);
      }),
    }));
  },

  async parseTranscript(ref: HarnessSessionRef): Promise<ParsedTranscript> {
    const entries = (await ref.loadEntries()) as ClaudeEntry[];
    return parseTranscript(entries.map((e) => JSON.stringify(e)));
  },

  followSession(): FollowHandle {
    throw new Error("claude followSession is owned by the backend service");
  },
};
