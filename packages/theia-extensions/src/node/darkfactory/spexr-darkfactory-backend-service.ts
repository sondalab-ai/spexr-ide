import { injectable, unmanaged } from "@theia/core/shared/inversify";
import { basename } from "node:path";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { execFile } from "node:child_process";
import { configDirs as defaultConfigDirs, projectsDirOf } from "./config-dirs.js";
import type { ParsedTranscript } from "./transcript-parser.js";
import { classifySession } from "./session-state.js";
import { liveProjectDirs as defaultLiveProjectDirs } from "./process-scanner.js";
import { claudeHarness, scanClaudeTranscripts, type TranscriptRef } from "../../common/harness/claude-harness.js";
import { opencodeHarness } from "../../common/harness/opencode-harness.js";
import { installedHarnesses, type DetectFn } from "../../common/harness/harness-registry.js";
import { once } from "../../common/harness/once.js";
import type { HarnessAdapter, HarnessSessionRef } from "../../common/harness/harness-types.js";
import { readBoundedLines } from "./bounded-read.js";
import { distillAction, recentActions, lastActionFailed } from "./action-distiller.js";
import { buildTurnsText, buildFollowEvents, type TurnEntry } from "./turns.js";
import { parseSessionSummary, type DescriptionGenerator } from "../search/description-format.js";
import type {
  AgentSummary,
  AgentTile,
  FocusPlan,
  SpexrDarkfactoryService,
  SpexrDarkfactoryClient,
} from "../../common/darkfactory-protocol.js";

const EMPTY_SUMMARY: AgentSummary = { now: "", overview: "" };

/** Follow backfill cap: how many recent events the read-only view seeds with. */
const FOLLOW_EVENTS = 40;
const SUMMARY_TURNS = 14;
const PALETTE_SIZE = 8;
/**
 * Only the most-recently-active sessions are read on each scan. Transcript
 * history runs to hundreds of files, some tens of MB; reading them all on every
 * filewatcher tick stalled the backend event loop. The wall only surfaces recent
 * work anyway, so cap the parse to this many newest sessions.
 */
const RECENT_LIMIT = 60;

/**
 * Transcript parses run concurrently up to this limit. Each opencode session is
 * an `opencode export` CLI spawn (~0.5s); parsed sequentially, 60 sessions
 * stalled the scan for ~30s. 8 keeps the spawn/memory pressure modest.
 */
const PARSE_CONCURRENCY = 8;

/** All harnesses the wall can scan; detection decides which are installed. */
const ALL_HARNESSES: HarnessAdapter[] = [claudeHarness, opencodeHarness];

/** One session from any harness, with its owning harness for parse/focus routing. */
interface UnifiedRef {
  harness: HarnessAdapter;
  ref: HarnessSessionRef;
  /** Claude only: the transcript file (bounded read + fs.watch follow). */
  claude?: TranscriptRef;
}

/** Constructor seams so the service is unit-testable without a real home dir. */
export interface DarkfactoryDeps {
  configDirs?: string[];
  /** Config dir the launch command actually resumes against (env CLAUDE_CONFIG_DIR). */
  resumableConfigDir?: string;
  now?: () => number;
  listTranscripts?: () => Promise<UnifiedRef[]>;
  liveProjectDirs?: () => Promise<Set<string> | null>;
  /** Which harnesses are installed; default resolves each binary via PATH. */
  detect?: DetectFn;
  /** opencode storage dir to watch for live tile pushes; undefined → none. */
  opencodeDataDir?: () => string | undefined;
  /** Directory-watch seam (default: node:fs `watch`); tests capture the calls. */
  watchDir?: (dir: string, recursive: boolean, onChange: () => void) => FSWatcher;
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
  /** The harness that owns this session (drives planFocus routing). */
  harnessId: string;
}

@injectable()
export class SpexrDarkfactoryBackendService implements SpexrDarkfactoryService {
  private readonly configDirs: string[];
  private readonly resumableConfigDir: string;
  private readonly now: () => number;
  private readonly listTranscripts: () => Promise<UnifiedRef[]>;
  private readonly liveDirs: () => Promise<Set<string> | null>;
  /** Test-injected synchronous detection; absent in production (login-shell probe). */
  private readonly detectSync: DetectFn | undefined;
  /** opencode storage dir (parent of opencode.db) to watch; injected in tests. */
  private readonly opencodeDataDirOf: () => string | undefined;
  /** Directory-watch seam (default: node:fs `watch`); tests capture the calls. */
  private readonly watchDir: (dir: string, recursive: boolean, onChange: () => void) => FSWatcher;
  /** Memoized installed-harness set — resolved lazily so injected seams never spawn a probe. */
  private installedCache?: Promise<HarnessAdapter[]>;
  /** True once setClient armed the wall watchers (guards re-entry). */
  private watching = false;

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
    this.detectSync = d.detect;
    this.opencodeDataDirOf = d.opencodeDataDir ?? defaultOpencodeDataDir;
    this.watchDir = d.watchDir ?? ((dir, recursive, onChange) => watch(dir, { recursive }, onChange));
    this.listTranscripts = d.listTranscripts ?? (() => this.defaultListTranscripts());
    this.liveDirs =
      d.liveProjectDirs ??
      (async () => {
        const installed = await this.installed();
        return defaultLiveProjectDirs(undefined, undefined, installed.flatMap((h) => h.processNames()));
      });
    this.generator = d.generator;
  }

  /**
   * Which harnesses are installed, resolved once. Tests inject a synchronous
   * `detect`; in production Claude is the hard dependency (always present) and
   * every other harness is probed via a login-shell `command -v` (opencode lives
   * on the user's PATH, e.g. /opt/homebrew/bin, which the app process may not
   * inherit). Lazy + memoized so injected-seam tests never spawn the probe.
   */
  private installed(): Promise<HarnessAdapter[]> {
    return (this.installedCache ??= this.detectSync
      ? Promise.resolve(installedHarnesses(ALL_HARNESSES, this.detectSync))
      : detectInstalledHarnesses(ALL_HARNESSES));
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
    const refs = [...allRefs].sort((a, b) => b.ref.mtimeMs - a.ref.mtimeMs).slice(0, RECENT_LIMIT);
    // Parse each transcript once; track the newest transcript mtime per project
    // so "working" is attributed to a single session per project. Parses run
    // concurrently (bounded) — sequential parsing serialized ~60 harness calls,
    // which for opencode is one CLI spawn per session (~30s total).
    const parsed = new Map<string, { u: UnifiedRef; entries: TurnEntry[]; parsed: ParsedTranscript }>();
    const newestByProject = new Map<string, number>();
    await forEachConcurrent(refs, PARSE_CONCURRENCY, async (u) => {
      const p = await u.harness.parseTranscript(u.ref);
      if (!p.cwd) return; // no real project path → skip
      if (!p.interactive) return; // SDK / one-shot subagent session → not followable
      const entries = (await u.ref.loadEntries()) as TurnEntry[];
      parsed.set(u.ref.sessionId, { u, entries, parsed: p });
      const prev = newestByProject.get(p.cwd);
      if (prev === undefined || u.ref.mtimeMs > prev) newestByProject.set(p.cwd, u.ref.mtimeMs);
    });

    this.index.clear();
    const tiles: AgentTile[] = [];
    // Iterate refs (not the parse map) so tile order stays recency-based, not completion-order.
    for (const u of refs) {
      const item = parsed.get(u.ref.sessionId);
      if (!item) continue;
      const { entries, parsed: p } = item;
      const cwd = p.cwd!;
      const ref = u.ref;
      const isNewest = newestByProject.get(cwd) === ref.mtimeMs;
      const { state, needsYou, needsYouCertain } = classifySession(cwd, ref.mtimeMs, isNewest, live, now, entries, p.permissionMode);
      const action = distillAction(entries);
      this.index.set(ref.sessionId, {
        transcriptPath: u.claude?.transcriptPath ?? "",
        projectPath: cwd,
        configDir: u.claude?.configDir ?? "",
        state,
        mtimeMs: ref.mtimeMs,
        harnessId: u.harness.id,
      });
      tiles.push({
        sessionId: ref.sessionId,
        transcriptPath: u.claude?.transcriptPath ?? "",
        projectPath: cwd,
        projectName: basename(cwd),
        state,
        needsYou,
        needsYouCertain,
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
    // Claude: follow read-only when the session is live elsewhere OR when it lives
    // in a config dir the launch command can't resume against. Opencode has no
    // per-account config dir (always resumable) and no read-only follow yet
    // (Slice 5), so a live opencode session opens a resume terminal — forked from
    // the live history by the caller (see the wall widget) so it never disturbs the
    // running session.
    const opencode = meta?.harnessId === "opencode";
    const resumable = !!meta && (opencode || meta.configDir === this.resumableConfigDir);
    const kind = (!opencode && meta?.state === "working") || !resumable ? "readonly-follow" : "resume-terminal";
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
      const events = buildFollowEvents(entries, FOLLOW_EVENTS);
      if (events.length) this.client?.onFollowChunk(sessionId, events);
    };
    let watcher: FSWatcher;
    try {
      watcher = watch(meta.transcriptPath, debounce(() => void emit().catch(() => {}), 250));
    } catch {
      return; // transcript vanished (or no file-backed transcript — opencode, Slice 5)
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
    if (this.watching) return;
    this.watching = true;
    const onChange = debounce(() => {
      void this.pushTiles();
    }, 400);
    for (const dir of this.configDirs) {
      try {
        // NOTE: `recursive` is implemented only on macOS and Windows; on Linux it
        // throws and is swallowed here, so live push-refresh is inert there (the
        // wall still refreshes on its own listTiles calls). Known follow-up.
        this.wallWatchers.push(this.watchDir(projectsDirOf(dir), true, onChange));
      } catch {
        /* directory missing (or recursive unsupported) → no live push for it */
      }
    }
    void this.armOpencodeWatch(onChange);
  }

  /**
   * opencode keeps every session in one SQLite db (per-slice spike R1) — there
   * is no per-session file to tail — so the wall watches the db's parent data
   * dir instead: an OS notification on the directory, never an open of the db
   * itself. Armed only when opencode is installed; detection is async, so this
   * lands a tick after the Claude watchers and shares their debounced push.
   * Non-recursive on purpose: the db and its -wal/-shm siblings live directly
   * in the data dir, and this keeps Linux inotify working (see NOTE above).
   */
  private async armOpencodeWatch(onChange: () => void): Promise<void> {
    const installed = await this.installed();
    if (!this.watching) return; // disposed while detection was in flight
    if (!installed.some((h) => h.id === "opencode")) return;
    const dir = this.opencodeDataDirOf();
    if (!dir) return;
    try {
      this.wallWatchers.push(this.watchDir(dir, false, onChange));
    } catch {
      /* directory missing → no live push for it */
    }
  }

  private async pushTiles(): Promise<void> {
    try {
      this.client?.onTilesChanged(await this.listTiles());
    } catch {
      /* transient scan failure → skip this tick */
    }
  }

  /** Merge every installed harness's session list (Claude: disk walk, opencode: db query). */
  private async defaultListTranscripts(): Promise<UnifiedRef[]> {
    const out: UnifiedRef[] = [];
    const installed = await this.installed();
    if (installed.includes(claudeHarness)) {
      const claudeRefs = await scanClaudeTranscripts(this.configDirs);
      for (const r of claudeRefs) {
        out.push({
          harness: claudeHarness,
          ref: {
            sessionId: r.sessionId,
            projectPath: "", // resolved from the transcript's cwd at parse time (as today)
            mtimeMs: r.mtimeMs,
            loadEntries: once(async () => {
              const lines = await readBoundedLines(r.transcriptPath);
              return lines.map(parseLine).filter((e): e is TurnEntry => !!e);
            }),
          },
          claude: r,
        });
      }
    }
    for (const h of installed) {
      if (h.id === "claude") continue;
      const refs = await h.listSessions();
      for (const ref of refs) out.push({ harness: h, ref });
    }
    return out;
  }

  dispose(): void {
    this.watching = false;
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

/**
 * Whether `bin` resolves on the user's login-shell PATH. Runs the same kind of
 * login+interactive shell the resume terminals use, so detection matches where
 * the resume actually finds the binary (e.g. /opt/homebrew/bin for opencode,
 * which the Electron backend's own PATH may not include). `bin` comes from the
 * hardcoded harness list, never user input.
 */
function commandExists(bin: string): Promise<boolean> {
  const shell = process.env.SHELL || "/bin/zsh";
  return new Promise((resolve) => {
    execFile(shell, ["-lic", `command -v ${bin}`], { timeout: 5000 }, (err, stdout) => {
      resolve(!err && stdout.trim().length > 0);
    });
  });
}

/** Claude is the hard dependency (always installed); probe every other harness via `command -v`. */
export async function detectInstalledHarnesses(adapters: HarnessAdapter[]): Promise<HarnessAdapter[]> {
  const flags = await Promise.all(
    adapters.map((a) => (a.id === "claude" ? Promise.resolve(true) : commandExists(a.id))),
  );
  return adapters.filter((_, i) => flags[i]);
}

/**
 * opencode's storage dir — the parent of its single `opencode.db` — where every
 * session write lands. Follows opencode's XDG convention (verified against
 * `opencode debug paths`); watched by the wall for live tile pushes.
 */
export function defaultOpencodeDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_DATA_HOME?.trim();
  return xdg ? join(xdg, "opencode") : join(homedir(), ".local", "share", "opencode");
}

async function readFileLines(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8")).split("\n");
  } catch {
    return [];
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

/**
 * Run `fn` over every item with at most `limit` calls in flight, resolving when
 * all complete. Errors propagate (callers fail soft inside `fn`).
 */
export async function forEachConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]!;
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
