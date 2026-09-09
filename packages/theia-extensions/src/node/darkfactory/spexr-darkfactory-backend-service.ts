import { injectable, unmanaged } from "@theia/core/shared/inversify";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { execFile } from "node:child_process";
import { Session as InspectorSession } from "node:inspector";
import {
  configDirs as defaultConfigDirs,
  defaultAccountDir,
  describeConfigDirs,
  projectsDirOf,
} from "./config-dirs.js";
import type { ParsedTranscript } from "./transcript-parser.js";
import { classifySession } from "./session-state.js";
import { liveProjectDirs as defaultLiveProjectDirs } from "./process-scanner.js";
import {
  claudeHarness,
  scanClaudeTranscripts,
  type TranscriptRef,
} from "../../common/harness/claude-harness.js";
import { opencodeHarness } from "../../common/harness/opencode-harness.js";
import { installedHarnesses, type DetectFn } from "../../common/harness/harness-registry.js";
import { once } from "../../common/harness/once.js";
import type { HarnessAdapter, HarnessSessionRef } from "../../common/harness/harness-types.js";
import { readBoundedLines } from "./bounded-read.js";
import { buildTile } from "./tile-builder.js";
import { forEachConcurrent as fanOut } from "./concurrency.js";
import { loadSessionIndex, saveSessionIndex } from "./session-index-store.js";
import { indexedText, type SessionRecord } from "./session-index.js";
import { hashDoc } from "./session-indexer.js";
import { loadSessionNames, saveSessionNames } from "./session-names-store.js";
import { runSessionIndex, type IndexableSession } from "./session-indexer.js";
import { rankSessions, type RankedSession } from "./session-query.js";
import { readFirstPrompt } from "./session-goal.js";
import { expandQuery } from "../search/query-expander.js";
import type { SessionIndex } from "./session-index.js";
import { forEachConcurrent } from "./concurrency.js";

export { forEachConcurrent };
import { nowActionLine } from "./action-distiller.js";
import { buildFollowEvents, sessionGoal, recentAssistantProse, type TurnEntry } from "./turns.js";
import {
  buildNowPrompt,
  buildOverviewPrompt,
  cleanSummaryLine,
  type DescriptionGenerator,
} from "../search/description-format.js";
import type {
  AgentSummary,
  AgentTile,
  ClaudeConfigDir,
  FocusPlan,
  SessionHit,
  SpexrDarkfactoryService,
  SpexrDarkfactoryClient,
} from "../../common/darkfactory-protocol.js";
import { MAX_SESSION_NAME_CHARS } from "../../common/darkfactory-protocol.js";

const EMPTY_SUMMARY: AgentSummary = { now: "", overview: "" };

/** Follow backfill cap: how many recent events the read-only view seeds with. */
const FOLLOW_EVENTS = 40;
/** How many recent assistant prose segments feed the now/overview summary model. */
const SUMMARY_PROSE_TURNS = 4;
/**
 * Below this much combined goal+progress the small local model fabricates content
 * ("developing a web application using Python and Flask…") instead of summarizing,
 * so the inference is skipped and Now falls back to the deterministic action line.
 * Tuned for chip-free input: the summary is now fed goal + assistant prose only
 * (no tool chips), which is far shorter than the old turns digest — a resumed
 * session with a terse goal ("continua") but real work must still clear this.
 */
const MIN_SUMMARY_CHARS = 60;
/**
 * Only the most-recently-active sessions are read on each scan. Transcript
 * history runs to hundreds of files, some tens of MB; reading them all on every
 * filewatcher tick stalled the backend event loop. The wall only surfaces recent
 * work anyway, so cap the parse to this many newest sessions.
 */
const RECENT_LIMIT = 60;

/** Enumeration freshness floor for the search path, mirroring LIVE_DIRS_TTL_MS. */
const ENUM_TTL_MS = 15_000;

/**
 * The session index crawl waits this long after startup, so it never competes
 * with the first wall scan for the event loop.
 */
const FIRST_CRAWL_DELAY_MS = 10_000;

/**
 * Transcript parses run concurrently up to this limit. Each opencode session is
 * an `opencode export` CLI spawn (~0.5s); parsed sequentially, 60 sessions
 * stalled the scan for ~30s. 8 keeps the spawn/memory pressure modest.
 */
const PARSE_CONCURRENCY = 8;

/**
 * Live-process-dir freshness floor. `ps` only anchors the "working" attribution
 * and costs one spawn per scan — with an active opencode session the db-write
 * watcher retriggers scans faster than they finish, and uncached `ps` calls
 * piled a spawn storm onto the backend. 15s is plenty for a liveness hint.
 */
const LIVE_DIRS_TTL_MS = 15_000;

/**
 * Wall poll cadence. The fs watchers are the fast path, not a complete one: a
 * config dir that gains its first session after startup is watched by nobody, a
 * watcher that errors is dropped and never re-armed (see armWallWatcher), and a
 * transcript scanned mid-write is discarded by listTiles with no later event to
 * bring it back. Sessions started outside SPEXR fell into those gaps and stayed
 * invisible for the life of the process. This tick is the floor under all of
 * them; it shares pushTiles' single-flight, so landing on a running scan is free.
 */
const POLL_INTERVAL_MS = 20_000;

/**
 * Config-dir discovery freshness floor. Discovery is a `readdirSync` of $HOME
 * plus a `statSync` per `.claude*` entry, and it now sits on the `listTiles`
 * path — which the 400ms-debounced watcher drives, not just the poll. Kept
 * shorter than {@link POLL_INTERVAL_MS} so every poll sees fresh discovery
 * while a burst of watcher events reuses one readdir.
 */
const CONFIG_DIRS_TTL_MS = 10_000;

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
  /** Fixed list, or a provider re-read on every scan (production discovers per scan). */
  configDirs?: string[] | (() => string[]);
  /** Config dir the launch command actually resumes against (env CLAUDE_CONFIG_DIR). */
  resumableConfigDir?: string;
  /** Account a new session starts under; defaults to `~/.claude`. */
  defaultAccountDir?: string;
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
  /** Sentence encoder for the session index; absent in tests that do not search. */
  embed?: (texts: string[]) => Promise<Float32Array[]>;
  /** Index location override, so tests never touch the real home directory. */
  sessionIndexPath?: string;
  /** Session-name store override, so tests never touch the real home directory. */
  sessionNamesPath?: string;
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
  /** Entry loader from the last scan — summary source for file-less transcripts (opencode). */
  loadEntries?: () => Promise<unknown[]>;
}

/**
 * The ranking half of a hit. Both places that build a `SessionHit` — the tiles
 * the last scan already has, and the archived sessions parsed on demand — go
 * through this, so a new match field cannot reach one and miss the other.
 */
function matchOf({ score, dense, lexical, terms }: RankedSession): Omit<SessionHit, "tile" | "archived"> {
  return { score, dense, lexical, terms };
}

/**
 * The stored name as a spreadable fragment, so both `buildTile` call sites — the
 * wall scan and search's archived branch — attach it the same way, and an
 * unnamed session carries no key at all.
 */
function nameOf(names: Map<string, string>, sessionId: string): { customName?: string } {
  const name = names.get(sessionId);
  return name ? { customName: name } : {};
}

@injectable()
export class SpexrDarkfactoryBackendService implements SpexrDarkfactoryService {
  private readonly configDirsSource: string[] | (() => string[]);
  private readonly resumableConfigDir: string;
  private readonly defaultAccountDir: string;
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
  /** Periodic rescan timer; the watchers are the fast path, this is the floor. */
  private poll: ReturnType<typeof setInterval> | undefined;
  private readonly wallWatchers: FSWatcher[] = [];
  /** Single-flight push state: while a scan runs, events mark it dirty for one follow-up scan. */
  private scanInFlight = false;
  private scanDirty = false;
  /** TTL cache of the live-process dirs (one `ps` spawn per TTL, not per scan). */
  private liveCache?: { at: number; value: Set<string> | null };
  /** TTL cache of discovered config dirs (one $HOME readdir per TTL, not per scan). */
  private configDirsCache?: { at: number; value: string[] };
  private readonly index = new Map<string, SessionMeta>();
  /**
   * Metadata for sessions reached through search, not through the scan.
   * `listTiles` clears `index` on every poll, so a hit registered there would
   * stop opening within one interval; this map is owned by the search path and
   * only grows, so a hit the user pinned stays openable after later queries.
   */
  private readonly searchMeta = new Map<string, SessionMeta>();
  /**
   * The tiles the last scan produced, so a hit inside the window is returned
   * as-is rather than re-parsed and re-classified with different inputs.
   */
  private readonly lastTiles = new Map<string, AgentTile>();
  /**
   * Enumeration is a full transcript scan plus an `opencode db` spawn; a query
   * must not pay for it on every debounce.
   */
  private enumCache?: { at: number; value: UnifiedRef[] };
  private sessionIndex?: Promise<SessionIndex>;
  private indexing = false;
  private readonly embed: ((texts: string[]) => Promise<Float32Array[]>) | undefined;
  private readonly sessionIndexPath: string | undefined;
  private readonly sessionNamesPath: string | undefined;
  /** sessionId → the name the user gave it; loaded once, then kept in step with writes. */
  private sessionNames?: Promise<Map<string, string>>;
  /** sessionId → { mtimeMs, summary } AI-summary cache, invalidated on transcript change. */
  private readonly summaryCache = new Map<string, { mtimeMs: number; summary: AgentSummary }>();
  /** sessionId → { watcher, offset } for active read-only follows. */
  private readonly follows = new Map<string, { watcher: FSWatcher; offset: number }>();

  // @unmanaged(): inversify must not manage this optional test seam.
  constructor(@unmanaged() deps?: DarkfactoryDeps) {
    const d = deps ?? {};
    this.configDirsSource = d.configDirs ?? defaultConfigDirs;
    this.now = d.now ?? Date.now; // before currentConfigDirs(), which keys its TTL on it
    this.resumableConfigDir =
      d.resumableConfigDir ??
      process.env.CLAUDE_CONFIG_DIR?.trim() ??
      this.currentConfigDirs()[0] ??
      "";
    this.defaultAccountDir = d.defaultAccountDir ?? defaultAccountDir();
    this.detectSync = d.detect;
    this.opencodeDataDirOf = d.opencodeDataDir ?? defaultOpencodeDataDir;
    this.watchDir =
      d.watchDir ?? ((dir, recursive, onChange) => watch(dir, { recursive }, onChange));
    this.listTranscripts = d.listTranscripts ?? (() => this.defaultListTranscripts());
    this.liveDirs =
      d.liveProjectDirs ??
      (async () => {
        const installed = await this.installed();
        return defaultLiveProjectDirs(
          undefined,
          undefined,
          installed.flatMap((h) => h.processNames()),
        );
      });
    this.generator = d.generator;
    this.embed = d.embed;
    this.sessionIndexPath = d.sessionIndexPath;
    this.sessionNamesPath = d.sessionNamesPath;
    if (this.embed) {
      setTimeout(() => void this.indexNow().catch(() => {}), FIRST_CRAWL_DELAY_MS).unref?.();
    }
  }

  /**
   * The Claude config dirs to scan, re-resolved on every call. Discovery used to
   * run once in the constructor, so an account dir created — or given its first
   * `projects/` — after startup stayed invisible for the life of the process.
   * Production discovery is memoized for {@link CONFIG_DIRS_TTL_MS} so a burst of
   * watcher events costs one $HOME readdir, not one per scan. Tests inject a
   * fixed list (or a provider) through {@link DarkfactoryDeps}.
   */
  private currentConfigDirs(): string[] {
    if (typeof this.configDirsSource !== "function") return this.configDirsSource;
    // An injected provider stays uncached: it is the seam that proves rediscovery
    // happens at all, and a TTL in front of it would hide exactly that.
    if (this.configDirsSource !== defaultConfigDirs) return this.configDirsSource();
    const now = this.now();
    if (this.configDirsCache && now - this.configDirsCache.at < CONFIG_DIRS_TTL_MS) {
      return this.configDirsCache.value;
    }
    const value = this.configDirsSource();
    this.configDirsCache = { at: now, value };
    return value;
  }

  /**
   * Which harnesses are installed, resolved once. Tests inject a synchronous
   * `detect`; in production each harness answers for itself, defaulting to a
   * login-shell `command -v` (opencode lives on the user's PATH, e.g.
   * /opt/homebrew/bin, which the app process may not inherit). Lazy + memoized
   * so injected-seam tests never spawn the probe.
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
  /**
   * Session metadata from the last scan, falling back to what search resolved.
   * Search hits live outside the scan window, and `listTiles` clears its own map
   * on every poll, so without the fallback an older hit stops opening.
   */
  private meta(sessionId: string): SessionMeta | undefined {
    return this.index.get(sessionId) ?? this.searchMeta.get(sessionId);
  }

  async summarize(sessionId: string): Promise<AgentSummary> {
    const meta = this.meta(sessionId);
    if (!meta) return EMPTY_SUMMARY;
    const cached = this.summaryCache.get(sessionId);
    if (cached && cached.mtimeMs === meta.mtimeMs) return cached.summary;
    // Claude: read the transcript file fresh (bounded head+tail). Opencode has no
    // transcript file — its sessions live in the db — so use the scan's export
    // entries (already loaded and memoized on the indexed ref). Reading the empty
    // path used to hand the model an empty transcript, producing generic output.
    let summary = EMPTY_SUMMARY;
    let entries: TurnEntry[] = [];
    if (meta.transcriptPath) {
      const lines = await readBoundedLines(meta.transcriptPath);
      entries = lines.map(parseLine).filter((e): e is TurnEntry => !!e);
    } else if (meta.loadEntries) {
      entries = ((await meta.loadEntries()) ?? []) as TurnEntry[];
    }
    // Both lines are model-written from real content, via two SEPARATE single-clause
    // asks (the paired ask came back merged/first-person/echoing tool payloads):
    //  - Overview = the session goal grounded in recent progress prose (not a stale
    //    paraphrase of the first prompt; not the full turns digest, which made the
    //    model enumerate actions and overrun the token cap).
    //  - Now = the current task named from the most recent prose ("fixing the token
    //    expiry check") rather than the raw tool call.
    // Recent prose excludes tool chips, keeping the input small and enumeration-free.
    const goal = entries.length > 0 ? sessionGoal(entries) : "";
    const progress =
      entries.length > 0 ? recentAssistantProse(entries, SUMMARY_PROSE_TURNS).join("\n") : "";
    // Deterministic fallback for Now: always factual, used when the model is
    // unavailable, the context is thin, or the model returns nothing.
    let now = entries.length > 0 ? nowActionLine(entries) : "";
    let overview = "";
    // Thin-context guard on the combined goal+progress: below it the small model
    // fabricates rather than summarizes. The goal (real user text) dominates, so a
    // session with a substantial first prompt clears it even when prose is terse.
    const context = `${goal}\n${progress}`;
    if (this.generator?.isAvailable() && context.length >= MIN_SUMMARY_CHARS) {
      const [rawOverview, rawNow] = await Promise.all([
        goal
          ? this.generator.summarize(buildOverviewPrompt(goal, progress), "overview")
          : Promise.resolve(null),
        progress.trim()
          ? this.generator.summarize(buildNowPrompt(progress), "now")
          : Promise.resolve(null),
      ]);
      const modelOverview = rawOverview ? cleanSummaryLine(rawOverview) : "";
      const modelNow = rawNow ? cleanSummaryLine(rawNow) : "";
      if (modelOverview) overview = modelOverview;
      if (modelNow) now = modelNow;
    }
    if (now || overview) summary = { now, overview };
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
   * and attributable in time. With SPEXR_LOOP_PROFILE=1 each stall also dumps a
   * .cpuprofile (see {@link stallProfiler}) to attribute the block to a hotspot.
   */
  private startLoopMonitor(): void {
    if (this.loopMonitor) return;
    let last = Date.now();
    const dumpProfile = process.env.SPEXR_LOOP_PROFILE ? stallProfiler() : undefined;
    this.loopMonitor = setInterval(() => {
      const lag = Date.now() - last - 1000;
      if (lag > 750) {
        console.error(`[darkfactory] backend event loop blocked ~${lag}ms`);
        dumpProfile?.(lag);
      }
      last = Date.now();
    }, 1000);
    this.loopMonitor.unref?.();
  }

  async listTiles(): Promise<AgentTile[]> {
    const [allRefs, live, names] = await Promise.all([
      this.listTranscripts(),
      this.cachedLiveDirs(),
      this.loadNames(),
    ]);
    const now = this.now();
    // Only read the newest sessions — history is huge and reading it all stalls
    // the event loop; the wall only shows recent work.
    const refs = [...allRefs].sort((a, b) => b.ref.mtimeMs - a.ref.mtimeMs).slice(0, RECENT_LIMIT);
    // Parse each transcript once; track the newest transcript mtime per project
    // so "working" is attributed to a single session per project. Parses run
    // concurrently (bounded) — sequential parsing serialized ~60 harness calls,
    // which for opencode is one CLI spawn per session (~30s total).
    const parsed = new Map<
      string,
      { u: UnifiedRef; entries: TurnEntry[]; parsed: ParsedTranscript }
    >();
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
    this.lastTiles.clear();
    const tiles: AgentTile[] = [];
    // Iterate refs (not the parse map) so tile order stays recency-based, not completion-order.
    for (const u of refs) {
      const item = parsed.get(u.ref.sessionId);
      if (!item) continue;
      const { entries, parsed: p } = item;
      const cwd = p.cwd!;
      const ref = u.ref;
      const isNewest = newestByProject.get(cwd) === ref.mtimeMs;
      const { state, needsYou, needsYouCertain } = classifySession(
        cwd,
        ref.mtimeMs,
        isNewest,
        live,
        now,
        entries,
        p.permissionMode,
      );
      this.index.set(ref.sessionId, {
        transcriptPath: u.claude?.transcriptPath ?? "",
        projectPath: cwd,
        configDir: u.claude?.configDir ?? "",
        state,
        mtimeMs: ref.mtimeMs,
        harnessId: u.harness.id,
        loadEntries: ref.loadEntries,
      });
      const tile = buildTile({
        sessionId: ref.sessionId,
        harness: u.harness.id,
        transcriptPath: u.claude?.transcriptPath ?? "",
        projectPath: cwd,
        mtimeMs: ref.mtimeMs,
        entries,
        parsed: p,
        state,
        needsYou,
        needsYouCertain,
        hashToIndex,
        ...nameOf(names, ref.sessionId),
      });
      this.lastTiles.set(ref.sessionId, tile);
      tiles.push(tile);
    }
    // Evict AI-summary entries for sessions that no longer exist on disk, so the
    // cache tracks live sessions instead of growing unbounded over the process life.
    for (const id of this.summaryCache.keys()) {
      if (!this.index.has(id)) this.summaryCache.delete(id);
    }
    return tiles;
  }

  /**
   * The Claude accounts a new session can be started under. Discovery re-runs
   * here (see currentConfigDirs), so an account added after startup shows up as
   * soon as the wall asks again — there is no push channel for this list.
   *
   * Marked against the default account rather than `resumableConfigDir`: SPEXR
   * is often launched from a shell that exports CLAUDE_CONFIG_DIR, and that
   * value would otherwise label the launcher's "(default)" — and pre-select it —
   * with an account no new session would have used.
   */
  async listConfigDirs(): Promise<ClaudeConfigDir[]> {
    return describeConfigDirs(this.currentConfigDirs(), this.defaultAccountDir);
  }

  /**
   * Bring the session index up to date; at most one crawl runs at a time. Also
   * callable directly, which is how tests index without waiting for the timer.
   */
  async indexNow(): Promise<void> {
    if (this.indexing || !this.embed) return;
    this.indexing = true;
    try {
      const index = await this.loadIndex();
      await runSessionIndex({
        index,
        embed: this.embed,
        list: () => this.indexableSessions(),
        save: (i) => saveSessionIndex(i, this.sessionIndexPath),
        onProgress: (done, total) => this.client?.onSessionIndexProgress(done, total),
      });
    } finally {
      this.indexing = false;
    }
  }

  async searchSessions(query: string): Promise<SessionHit[]> {
    if (!query.trim() || !this.embed) return [];
    const index = await this.loadIndex();
    if (index.size === 0) return [];

    const expanded = expandQuery(query);
    const [vector] = await this.embed([expanded]);
    if (!vector) return [];
    const ranked = rankSessions(index, vector, expanded);
    if (ranked.length === 0) return [];

    // A hit the last scan already rendered is returned as that scan built it —
    // re-classifying it here would feed classifySession different inputs and
    // could demote a live session. Only sessions outside the window are parsed,
    // and only the hits among them, never the whole index.
    // The whole ranking is carried, not just the score: the archived branch
    // below builds its hits in a separate pass and needs the same match detail.
    const scored = new Map(ranked.map((r) => [r.sessionId, r]));
    const hits: SessionHit[] = [];
    const archived: string[] = [];
    for (const r of ranked) {
      const tile = this.lastTiles.get(r.sessionId);
      if (tile) hits.push({ tile, ...matchOf(r), archived: false });
      else archived.push(r.sessionId);
    }

    if (archived.length > 0) {
      const refs = new Map((await this.cachedTranscripts()).map((u) => [u.ref.sessionId, u]));
      const [live, names] = await Promise.all([this.cachedLiveDirs(), this.loadNames()]);
      const now = this.now();
      const built: SessionHit[] = [];
      await fanOut(archived, PARSE_CONCURRENCY, async (sessionId) => {
        const u = refs.get(sessionId);
        if (!u) return; // indexed but gone from disk; the next crawl drops it
        const p = await u.harness.parseTranscript(u.ref);
        if (!p.cwd || !p.interactive) return;
        const entries = (await u.ref.loadEntries()) as TurnEntry[];
        const { state, needsYou, needsYouCertain } = classifySession(
          p.cwd,
          u.ref.mtimeMs,
          false, // outside the scan window, so never its project's newest
          live,
          now,
          entries,
          p.permissionMode,
        );
        this.searchMeta.set(sessionId, {
          transcriptPath: u.claude?.transcriptPath ?? "",
          projectPath: p.cwd,
          configDir: u.claude?.configDir ?? "",
          state,
          mtimeMs: u.ref.mtimeMs,
          harnessId: u.harness.id,
          loadEntries: u.ref.loadEntries,
        });
        built.push({
          tile: buildTile({
            sessionId,
            harness: u.harness.id,
            transcriptPath: u.claude?.transcriptPath ?? "",
            projectPath: p.cwd,
            mtimeMs: u.ref.mtimeMs,
            entries,
            parsed: p,
            state,
            needsYou,
            needsYouCertain,
            hashToIndex,
            ...nameOf(names, sessionId),
          }),
          ...matchOf(scored.get(sessionId)!),
          archived: true,
        });
      });
      hits.push(...built);
    }

    hits.sort((a, b) => b.score - a.score);
    return hits;
  }

  /** Enumeration, cached briefly: one query must not rescan every transcript. */
  private async cachedTranscripts(): Promise<UnifiedRef[]> {
    const now = this.now();
    if (this.enumCache && now - this.enumCache.at < ENUM_TTL_MS) return this.enumCache.value;
    const value = await this.listTranscripts();
    this.enumCache = { at: now, value };
    return value;
  }

  /** The enumerated sessions, flattened into what the crawl needs. */
  private async indexableSessions(): Promise<IndexableSession[]> {
    const [refs, names] = await Promise.all([this.cachedTranscripts(), this.loadNames()]);
    return refs.map((u) => ({
      sessionId: u.ref.sessionId,
      harness: u.harness.id,
      transcriptPath: u.claude?.transcriptPath ?? "",
      configDir: u.claude?.configDir ?? "",
      mtimeMs: u.ref.mtimeMs,
      loadEntries: u.ref.loadEntries,
      parse: () => u.harness.parseTranscript(u.ref),
      ...(u.claude
        ? { readGoalHead: () => readFirstPrompt(u.claude!.transcriptPath) }
        : {}),
      ...nameOf(names, u.ref.sessionId),
    }));
  }

  private loadNames(): Promise<Map<string, string>> {
    if (!this.sessionNames) this.sessionNames = loadSessionNames(this.sessionNamesPath);
    return this.sessionNames;
  }

  /**
   * Name a session, or clear the name when `name` is blank. The tiles the last
   * scan produced are patched in place and pushed, so the card renames now
   * rather than at the next poll — and every window sees it, not just the one
   * that asked.
   */
  async renameSession(sessionId: string, name: string): Promise<void> {
    const names = await this.loadNames();
    const trimmed = name.trim().slice(0, MAX_SESSION_NAME_CHARS);
    if (trimmed) names.set(sessionId, trimmed);
    else names.delete(sessionId);
    await saveSessionNames(names, this.sessionNamesPath);

    await this.reindexName(sessionId, trimmed);

    const tile = this.lastTiles.get(sessionId);
    if (!tile) return;
    const { customName: _dropped, ...rest } = tile;
    this.lastTiles.set(sessionId, trimmed ? { ...rest, customName: trimmed } : rest);
    this.client?.onTilesChanged([...this.lastTiles.values()]);
  }

  /**
   * Make a renamed session findable by its new name straight away. The crawl
   * would not: it skips a session whose transcript mtime has not moved, and a
   * rename touches no transcript. Only this one record is rebuilt — its lexical
   * half from the new text, its vector re-encoded when an encoder is available.
   * Without one, the record is marked stale so the next crawl re-encodes it,
   * which leaves the name searchable lexically in the meantime.
   */
  private async reindexName(sessionId: string, name: string): Promise<void> {
    // Loaded rather than skipped when cold: an index sitting on disk unread would
    // otherwise keep the old name until something else touched the transcript,
    // because the crawl skips a session whose mtime has not moved.
    const index = await this.loadIndex();
    const existing = index.get(sessionId);
    if (!existing) return; // not indexed yet → the next crawl builds it named

    const { customName: _dropped, ...rest } = existing;
    const record: SessionRecord = name ? { ...rest, customName: name } : rest;
    record.docHash = hashDoc(indexedText(record));
    if (this.embed) {
      const [vector] = await this.embed([indexedText(record)]);
      if (vector) record.vector = vector;
    } else {
      record.mtimeMs = 0; // no encoder here: let the next crawl rebuild the vector
    }
    index.upsert(record);
    await saveSessionIndex(index, this.sessionIndexPath);
  }

  private loadIndex(): Promise<SessionIndex> {
    if (!this.sessionIndex) this.sessionIndex = loadSessionIndex(this.sessionIndexPath);
    return this.sessionIndex;
  }

  async planFocus(sessionId: string): Promise<FocusPlan> {
    const meta = this.meta(sessionId);
    const projectPath = meta?.projectPath ?? "";
    const configDir = meta?.configDir ?? "";
    // A WORKING session always opens read-only, on every harness: resuming it
    // would attach to (Claude) or risk disturbing the running session, and the
    // decision to fork is an explicit "Fork & continue" action in the pinned
    // card, never an automatic side effect of opening the tile. A session also
    // opens read-only when it lives in a config dir the launch command can't
    // resume against. Opencode has no per-account config dir (always resumable)
    // and no read-only follow yet (Slice 5), so its read-only view carries the
    // fork CTA with an empty transcript until then.
    const opencode = meta?.harnessId === "opencode";
    const resumable = !!meta && (opencode || meta.configDir === this.resumableConfigDir);
    const kind = meta?.state === "working" || !resumable ? "readonly-follow" : "resume-terminal";
    return { sessionId, projectPath, configDir, kind };
  }

  async startFollow(sessionId: string): Promise<void> {
    if (this.follows.has(sessionId)) return;
    const meta = this.meta(sessionId);
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
      watcher = watch(
        meta.transcriptPath,
        debounce(() => void emit().catch(() => {}), 250),
      );
    } catch {
      return; // transcript vanished (or no file-backed transcript — opencode, Slice 5)
    }
    // A watcher that fails after establishment emits `error`; unhandled, that
    // throws out of the backend. Drop the follow instead — stopFollow and a
    // later startFollow both stay correct against an absent entry.
    watcher.on("error", () => {
      void this.stopFollow(sessionId);
    });
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
    for (const dir of this.currentConfigDirs()) {
      try {
        // NOTE: `recursive` is implemented only on macOS and Windows; on Linux it
        // throws and is swallowed here, so live push-refresh is inert there (the
        // wall still refreshes on its own listTiles calls). Known follow-up.
        this.wallWatchers.push(this.armWallWatcher(projectsDirOf(dir), true, onChange));
      } catch {
        /* directory missing (or recursive unsupported) → no live push for it */
      }
    }
    void this.armOpencodeWatch(onChange);
    this.startPolling();
  }

  /**
   * Periodic full rescan, the safety net under the watchers (see
   * {@link POLL_INTERVAL_MS}). It goes through pushTiles, so a tick landing on
   * an in-flight scan coalesces instead of stacking another one.
   */
  private startPolling(): void {
    if (this.poll) return;
    this.poll = setInterval(() => {
      void this.pushTiles();
    }, POLL_INTERVAL_MS);
    this.poll.unref?.();
  }

  /**
   * Watch a wall directory with its `error` event handled. An FSWatcher that
   * fails after being established emits `error`, and an unhandled `error` on
   * an EventEmitter throws out of the backend process. The wall degrades to
   * refreshing on its own `listTiles` calls, which is what an unwatchable
   * directory already does.
   */
  private armWallWatcher(dir: string, recursive: boolean, onChange: () => void): FSWatcher {
    const watcher = this.watchDir(dir, recursive, onChange);
    watcher.on("error", () => {
      try {
        watcher.close();
      } catch {
        /* already closed */
      }
      const i = this.wallWatchers.indexOf(watcher);
      if (i >= 0) this.wallWatchers.splice(i, 1);
    });
    return watcher;
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
      this.wallWatchers.push(this.armWallWatcher(dir, false, onChange));
    } catch {
      /* directory missing → no live push for it */
    }
  }

  /**
   * Push a fresh tile snapshot, single-flight. An active opencode session can
   * fire the db watcher faster than a scan finishes; without coalescing each
   * event queued another full scan, so scans piled up and their `ps`/`opencode`
   * spawns stacked into a process-spawn storm. Here at most one scan runs at a
   * time; events arriving mid-scan only mark it dirty, so at most one follow-up
   * scan is queued no matter how many events land.
   */
  private async pushTiles(): Promise<void> {
    if (!this.client) return;
    this.scanDirty = true;
    if (this.scanInFlight) return;
    this.scanInFlight = true;
    try {
      while (this.scanDirty) {
        this.scanDirty = false;
        try {
          this.client.onTilesChanged(await this.listTiles());
        } catch {
          /* transient scan failure → skip this tick */
        }
      }
    } finally {
      this.scanInFlight = false;
    }
  }

  /**
   * Live-process dirs with a TTL: each miss spawns `ps`, and scans re-run far
   * more often than liveness changes. Keyed on the injected clock so tests can
   * drive expiry deterministically.
   */
  private async cachedLiveDirs(): Promise<Set<string> | null> {
    const now = this.now();
    if (this.liveCache && now - this.liveCache.at < LIVE_DIRS_TTL_MS) return this.liveCache.value;
    const value = await this.liveDirs();
    this.liveCache = { at: now, value };
    return value;
  }

  /** Merge every installed harness's session list (Claude: disk walk, opencode: db query). */
  private async defaultListTranscripts(): Promise<UnifiedRef[]> {
    const out: UnifiedRef[] = [];
    const installed = await this.installed();
    if (installed.includes(claudeHarness)) {
      const claudeRefs = await scanClaudeTranscripts(this.currentConfigDirs());
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
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = undefined;
    }
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

/**
 * Which of `adapters` are installed. The rule is uniform — each harness answers
 * for itself, falling back to a login-shell `command -v <id>` — so the detector
 * carries no knowledge of any particular harness.
 */
export async function detectInstalledHarnesses(
  adapters: HarnessAdapter[],
): Promise<HarnessAdapter[]> {
  const flags = await Promise.all(adapters.map((a) => a.isInstalled?.() ?? commandExists(a.id)));
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

/**
 * Continuous CPU profiler for stall attribution: runs from watchdog start and,
 * each time the watchdog fires, dumps the profile collected so far to the system
 * temp dir (open in DevTools or Speedscope to find the synchronous hotspot),
 * then restarts to capture the next stall. Opt-in via SPEXR_LOOP_PROFILE=1.
 */
function stallProfiler(): ((lagMs: number) => void) | undefined {
  try {
    const session = new InspectorSession();
    session.connect();
    session.post("Profiler.enable");
    session.post("Profiler.start");
    return (lagMs: number): void => {
      session.post("Profiler.stop", (err, params) => {
        if (err || !params) return;
        const file = join(tmpdir(), `spexr-stall-${Math.round(lagMs)}ms-${Date.now()}.cpuprofile`);
        void writeFile(file, JSON.stringify(params.profile)).then(() =>
          console.error(`[darkfactory] stall profile → ${file}`),
        );
        session.post("Profiler.start"); // keep capturing the next stall
      });
    };
  } catch {
    return undefined; // inspector unavailable → watchdog keeps logging only
  }
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

