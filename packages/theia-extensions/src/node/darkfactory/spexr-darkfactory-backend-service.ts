import { injectable, unmanaged } from "@theia/core/shared/inversify";
import { join, basename } from "node:path";
import { readdir, readFile, open, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { configDirs as defaultConfigDirs, projectsDirOf } from "./config-dirs.js";
import { parseTranscript } from "./transcript-parser.js";
import { classifySession } from "./session-state.js";
import { liveProjectDirs as defaultLiveProjectDirs } from "./process-scanner.js";
import { distillAction, recentActions, lastActionFailed } from "./action-distiller.js";
import { guessNeedsYou } from "./needs-you.js";
import { buildTurnsText, type TurnEntry } from "./turns.js";
import { parseSessionSummary, type DescriptionGenerator } from "../search/description-format.js";
import type {
  AgentSummary,
  AgentTile,
  FocusPlan,
  SpexrDarkfactoryService,
  SpexrDarkfactoryClient,
} from "../../common/darkfactory-protocol.js";

const EMPTY_SUMMARY: AgentSummary = { now: "", overview: "" };

const WORKING_WINDOW_MS = 45_000;
const FOLLOW_TURNS = 8;
const SUMMARY_TURNS = 14;
const PALETTE_SIZE = 8;
/**
 * Only the most-recently-active sessions are read on each scan. Transcript
 * history runs to hundreds of files, some tens of MB; reading them all on every
 * filewatcher tick stalled the backend event loop. The wall only surfaces recent
 * work anyway, so cap the parse to this many newest sessions.
 */
const RECENT_LIMIT = 60;
/** Bytes read from the head (goal/cwd/interactive markers) and tail (recent activity). */
const HEAD_BYTES = 32_768;
const TAIL_BYTES = 98_304;

/** One transcript file discovered on disk; `readLines` is lazy. */
export interface TranscriptRef {
  sessionId: string;
  transcriptPath: string;
  /** Config dir that owns this session (for `claude --resume`). */
  configDir: string;
  mtimeMs: number;
  readLines(): Promise<string[]>;
}

/** Constructor seams so the service is unit-testable without a real home dir. */
export interface DarkfactoryDeps {
  configDirs?: string[];
  /** Config dir the launch command actually resumes against (env CLAUDE_CONFIG_DIR). */
  resumableConfigDir?: string;
  now?: () => number;
  workingWindowMs?: number;
  listTranscripts?: () => Promise<TranscriptRef[]>;
  liveProjectDirs?: () => Promise<Set<string> | null>;
  /** Local model used to infer a one-line session description. */
  generator?: DescriptionGenerator;
}

/** Per-session bookkeeping from the last scan, for focus/follow. */
interface SessionMeta {
  transcriptPath: string;
  projectPath: string;
  configDir: string;
  state: AgentTile["state"];
  mtimeMs: number;
}

@injectable()
export class SpexrDarkfactoryBackendService implements SpexrDarkfactoryService {
  private readonly configDirs: string[];
  private readonly resumableConfigDir: string;
  private readonly now: () => number;
  private readonly workingWindowMs: number;
  private readonly listTranscripts: () => Promise<TranscriptRef[]>;
  private readonly liveDirs: () => Promise<Set<string> | null>;

  private readonly generator: DescriptionGenerator | undefined;
  private client?: SpexrDarkfactoryClient;
  private loopMonitor?: ReturnType<typeof setInterval>;
  private readonly wallWatchers: FSWatcher[] = [];
  private readonly index = new Map<string, SessionMeta>();
  /** sessionId → { mtimeMs, summary } AI-summary cache, invalidated on transcript change. */
  private readonly summaryCache = new Map<string, { mtimeMs: number; summary: AgentSummary }>();
  /** sessionId → { watcher, offset } for active read-only follows. */
  private readonly follows = new Map<string, { watcher: FSWatcher; offset: number }>();

  // @unmanaged(): inversify must not manage this optional test seam.
  constructor(@unmanaged() deps?: DarkfactoryDeps) {
    const d = deps ?? {};
    this.configDirs = d.configDirs ?? defaultConfigDirs();
    this.resumableConfigDir = d.resumableConfigDir ?? process.env.CLAUDE_CONFIG_DIR?.trim() ?? this.configDirs[0] ?? "";
    this.now = d.now ?? Date.now;
    this.workingWindowMs = d.workingWindowMs ?? WORKING_WINDOW_MS;
    this.listTranscripts = d.listTranscripts ?? (() => this.scanDisk());
    this.liveDirs = d.liveProjectDirs ?? (() => defaultLiveProjectDirs());
    this.generator = d.generator;
  }

  /**
   * Two-level AI description (now + overview) of a session, via the local model.
   * Cached by `sessionId + mtime`; returns empty fields when the model is unavailable.
   */
  async summarize(sessionId: string): Promise<AgentSummary> {
    const meta = this.index.get(sessionId);
    if (!meta) return EMPTY_SUMMARY;
    const cached = this.summaryCache.get(sessionId);
    if (cached && cached.mtimeMs === meta.mtimeMs) return cached.summary;
    let summary = EMPTY_SUMMARY;
    if (this.generator?.isAvailable()) {
      const lines = await readBoundedLines(meta.transcriptPath);
      const entries = lines.map(parseLine).filter((e): e is TurnEntry => !!e);
      const raw = await this.generator.summarize(buildTurnsText(entries, SUMMARY_TURNS));
      if (raw) summary = parseSessionSummary(raw);
    }
    this.summaryCache.set(sessionId, { mtimeMs: meta.mtimeMs, summary });
    return summary;
  }

  setClient(client: SpexrDarkfactoryClient): void {
    this.client = client;
    this.ensureWatching();
    this.startLoopMonitor();
  }

  /**
   * Diagnostic: log when the backend event loop was blocked well past the tick
   * interval, so a real main-thread stall (vs. a mere websocket drop) is visible
   * and attributable in time.
   */
  private startLoopMonitor(): void {
    if (this.loopMonitor) return;
    let last = Date.now();
    this.loopMonitor = setInterval(() => {
      const lag = Date.now() - last - 1000;
      if (lag > 750) console.error(`[darkfactory] backend event loop blocked ~${lag}ms`);
      last = Date.now();
    }, 1000);
    this.loopMonitor.unref?.();
  }

  async listTiles(): Promise<AgentTile[]> {
    const [allRefs, live] = await Promise.all([this.listTranscripts(), this.liveDirs()]);
    const now = this.now();
    // Only read the newest sessions — history is huge and reading it all stalls
    // the event loop; the wall only shows recent work.
    const refs = [...allRefs].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, RECENT_LIMIT);
    // Parse each transcript once; track the newest transcript mtime per project
    // so "working" is attributed to a single session per project.
    const parsed = new Map<string, { ref: TranscriptRef; lines: string[]; parsed: ReturnType<typeof parseTranscript> }>();
    const newestByProject = new Map<string, number>();
    for (const ref of refs) {
      const lines = await ref.readLines();
      const p = parseTranscript(lines);
      if (!p.cwd) continue; // no real project path → skip
      if (!p.interactive) continue; // SDK / one-shot subagent session → not followable
      parsed.set(ref.sessionId, { ref, lines, parsed: p });
      const prev = newestByProject.get(p.cwd);
      if (prev === undefined || ref.mtimeMs > prev) newestByProject.set(p.cwd, ref.mtimeMs);
    }

    this.index.clear();
    const tiles: AgentTile[] = [];
    for (const { ref, lines, parsed: p } of parsed.values()) {
      const cwd = p.cwd!;
      const isNewest = newestByProject.get(cwd) === ref.mtimeMs;
      const state = classifySession(cwd, ref.mtimeMs, isNewest, live, now, this.workingWindowMs);
      const entries = lines.map(parseLine).filter((e): e is TurnEntry => !!e);
      const action = distillAction(entries);
      const needsYou = guessNeedsYou(entries, state === "working", ref.mtimeMs, now);
      this.index.set(ref.sessionId, {
        transcriptPath: ref.transcriptPath,
        projectPath: cwd,
        configDir: ref.configDir,
        state,
        mtimeMs: ref.mtimeMs,
      });
      tiles.push({
        sessionId: ref.sessionId,
        transcriptPath: ref.transcriptPath,
        projectPath: cwd,
        projectName: basename(cwd),
        state,
        needsYou,
        needsYouCertain: false,
        lastFailed: lastActionFailed(entries),
        goal: p.goal || p.lastPrompt,
        actionLine: action.line,
        recentActions: recentActions(entries, 4),
        lastActivityMs: ref.mtimeMs,
        turnCount: p.userTurns,
        accentId: hashToIndex(cwd, PALETTE_SIZE),
        ...(action.tool !== undefined ? { tool: action.tool } : {}),
        ...(action.target !== undefined ? { target: action.target } : {}),
        ...(p.gitBranch !== undefined ? { gitBranch: p.gitBranch } : {}),
        ...(p.mode !== undefined ? { mode: p.mode } : {}),
        ...(p.permissionMode !== undefined ? { permissionMode: p.permissionMode } : {}),
      });
    }
    // Evict AI-summary entries for sessions that no longer exist on disk, so the
    // cache tracks live sessions instead of growing unbounded over the process life.
    for (const id of this.summaryCache.keys()) {
      if (!this.index.has(id)) this.summaryCache.delete(id);
    }
    return tiles;
  }

  async planFocus(sessionId: string): Promise<FocusPlan> {
    const meta = this.index.get(sessionId);
    const projectPath = meta?.projectPath ?? "";
    const configDir = meta?.configDir ?? "";
    // Follow read-only when the session is live elsewhere OR when it lives in a
    // config dir the launch command can't resume against (the resume would fail
    // with "no conversation"). Otherwise open an interactive resume terminal.
    const resumable = !!meta && meta.configDir === this.resumableConfigDir;
    const kind = meta?.state === "working" || !resumable ? "readonly-follow" : "resume-terminal";
    return { sessionId, projectPath, configDir, kind };
  }

  async startFollow(sessionId: string): Promise<void> {
    if (this.follows.has(sessionId)) return;
    const meta = this.index.get(sessionId);
    if (!meta) return;
    const emit = async (): Promise<void> => {
      const entry = this.follows.get(sessionId);
      if (!entry) return;
      const lines = await readFileLines(meta.transcriptPath);
      const fresh = lines.slice(entry.offset);
      entry.offset = lines.length;
      if (fresh.length === 0) return;
      const entries = fresh.map(parseLine).filter((e): e is TurnEntry => !!e);
      const turns = buildTurnsText(entries, FOLLOW_TURNS);
      if (turns) this.client?.onFollowChunk(sessionId, turns);
    };
    let watcher: FSWatcher;
    try {
      watcher = watch(meta.transcriptPath, debounce(() => void emit().catch(() => {}), 250));
    } catch {
      return; // transcript vanished
    }
    this.follows.set(sessionId, { watcher, offset: 0 });
    await emit(); // send the current tail immediately
  }

  async stopFollow(sessionId: string): Promise<void> {
    const entry = this.follows.get(sessionId);
    if (entry) {
      entry.watcher.close();
      this.follows.delete(sessionId);
    }
  }

  private ensureWatching(): void {
    if (this.wallWatchers.length) return;
    const onChange = debounce(() => {
      void this.pushTiles();
    }, 400);
    for (const dir of this.configDirs) {
      try {
        // NOTE: `recursive` is implemented only on macOS and Windows; on Linux it
        // throws and is swallowed here, so live push-refresh is inert there (the
        // wall still refreshes on its own listTiles calls). Known follow-up.
        this.wallWatchers.push(watch(projectsDirOf(dir), { recursive: true }, onChange));
      } catch {
        /* directory missing (or recursive unsupported) → no live push for it */
      }
    }
  }

  private async pushTiles(): Promise<void> {
    try {
      this.client?.onTilesChanged(await this.listTiles());
    } catch {
      /* transient scan failure → skip this tick */
    }
  }

  private async scanDisk(): Promise<TranscriptRef[]> {
    const refs: TranscriptRef[] = [];
    for (const configDir of this.configDirs) {
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

  dispose(): void {
    if (this.loopMonitor) clearInterval(this.loopMonitor);
    for (const w of this.wallWatchers) w.close();
    this.wallWatchers.length = 0;
    for (const { watcher } of this.follows.values()) watcher.close();
    this.follows.clear();
  }
}

function parseLine(line: string): TurnEntry | undefined {
  try {
    return JSON.parse(line) as TurnEntry;
  } catch {
    return undefined;
  }
}

async function readFileLines(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8")).split("\n");
  } catch {
    return [];
  }
}

/**
 * Stitch bounded head/tail reads back into whole JSON lines. When `truncated`,
 * the line straddling each cut is partial, so drop the head's last line and the
 * tail's first line; the middle of the transcript is intentionally skipped.
 */
export function stitchBoundedLines(head: string, tail: string, truncated: boolean): string[] {
  if (!truncated) return head.split("\n");
  const headLines = head.split("\n");
  headLines.pop();
  const tailLines = tail.split("\n");
  tailLines.shift();
  return [...headLines, ...tailLines];
}

/**
 * Read only the head and tail of a transcript (not the whole file — some run to
 * tens of MB). The head carries cwd/goal/interactive markers, the tail carries
 * recent activity; that is everything the wall and summary need.
 */
async function readBoundedLines(path: string): Promise<string[]> {
  let fh;
  try {
    fh = await open(path, "r");
  } catch {
    return [];
  }
  try {
    const { size } = await fh.stat();
    if (size <= HEAD_BYTES + TAIL_BYTES) {
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, 0);
      return stitchBoundedLines(buf.toString("utf8"), "", false);
    }
    const headBuf = Buffer.alloc(HEAD_BYTES);
    await fh.read(headBuf, 0, HEAD_BYTES, 0);
    const tailBuf = Buffer.alloc(TAIL_BYTES);
    await fh.read(tailBuf, 0, TAIL_BYTES, size - TAIL_BYTES);
    return stitchBoundedLines(headBuf.toString("utf8"), tailBuf.toString("utf8"), true);
  } catch {
    return [];
  } finally {
    await fh.close();
  }
}

/** Stable 32-bit string hash mapped into [0, n). */
export function hashToIndex(s: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % n;
}

function debounce<T extends (...a: never[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...a: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  }) as T;
}
