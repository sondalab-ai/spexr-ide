import { watch, type FSWatcher } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { parseSpecPlan } from "@spexr/spec";
import { buildAgentPaneSnapshot, diffSnapshots, parseCheckboxes, type PaneEntry } from "./agent-events.js";
import { chooseSuccessor, type SuccessorCandidate } from "./agent-successor.js";
import { configDirs, projectsDirOf } from "./config-dirs.js";
import { readFollowChunk, type FollowCursor } from "./follow-reader.js";
import { SessionLineage, lineageNode, readRoot, type LineageNode } from "./session-lineage.js";
import { loadSessionNames, resolveSessionNamesPath } from "./session-names-store.js";
import { classifySession } from "./session-state.js";
import { liveProjectDirs } from "./process-scanner.js";
import { ToolCounter } from "./tool-count.js";
import { parseTranscript } from "./transcript-parser.js";
import type { AgentPaneBinding, AgentPaneClient, AgentPaneService, AgentPaneSnapshot, PanePlanItem } from "../../common/agent-pane-protocol.js";

/** How much of a transcript's end the first read takes: a turn's head can be far back in a long one. */
const TAIL_BYTES = 4 << 20;
/** Entries kept; older ones are past any turn the pane shows. */
const MAX_ENTRIES = 6000;
const DEBOUNCE_MS = 150;
/** How often a transcript that does not exist yet is looked for. */
const LOCATE_MS = 1500;
/** The wait for a transcript that is not there backs off to this, and ends after {@link LOCATE_GIVE_UP_MS}. */
const LOCATE_MAX_MS = 15_000;
const LOCATE_GIVE_UP_MS = 10 * 60_000;
const LIVE_TTL_MS = 5000;
/** The project folder is listed for a successor at most this often: it can hold thousands of transcripts. */
const SUCCESSOR_EVERY_MS = 3000;
/** The spec plan is read again at most this often. */
const SPEC_PLAN_TTL_MS = 5000;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The folder name Claude Code gives a project: every character that is not a letter or digit becomes `-`. */
export function encodeProjectDir(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Injectable seams, so the service is driven without a clock, a watcher or a process table. */
export interface AgentPaneDeps {
  configDirs?: () => string[];
  now?: () => number;
  /** Watch a path; returns a closer, or undefined when it cannot be watched. */
  watch?: (path: string, onChange: () => void) => { close(): void } | undefined;
  liveDirs?: () => Promise<Set<string> | null>;
  /** The session names file; the pane's title is the name the user gave. */
  namesPath?: string;
  /** The checkboxes of the workspace's spec plan, the last of the plan chain. */
  specPlan?: (workspacePath: string) => Promise<PanePlanItem[] | undefined>;
  debounceMs?: number;
  /** The tool counter, shared with the wall so a transcript is scanned once. */
  counter?: ToolCounter;
}

const defaultWatch = (path: string, onChange: () => void): { close(): void } | undefined => {
  try {
    const w: FSWatcher = watch(path, onChange);
    // A watcher that fails later throws out of the backend unless handled.
    w.on("error", () => w.close());
    return w;
  } catch {
    return undefined;
  }
};

/** The newest `docs/specs/.context/<slug>/_plan.md`, as plan items; undefined when none has tasks. */
export async function readSpecPlan(workspacePath: string): Promise<PanePlanItem[] | undefined> {
  const root = join(workspacePath, "docs", "specs", ".context");
  let slugs: string[];
  try {
    slugs = await readdir(root);
  } catch {
    return undefined;
  }
  const plans = (
    await Promise.all(
      slugs.map(async (slug) => {
        try {
          const file = join(root, slug, "_plan.md");
          return { file, slug, mtimeMs: (await stat(file)).mtimeMs };
        } catch {
          return undefined;
        }
      }),
    )
  )
    .filter((p): p is { file: string; slug: string; mtimeMs: number } => !!p)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const plan of plans) {
    try {
      const raw = await readFile(plan.file, "utf8");
      const doc = parseSpecPlan(raw, plan.slug);
      const items = doc.tasks.map((t) => ({ text: `${t.id} ${t.description}`, done: t.done }));
      if (items.length > 0) return items;
      const boxes = parseCheckboxes(raw);
      if (boxes) return boxes;
    } catch {
      /* unreadable plan: try the next */
    }
  }
  return undefined;
}

function parse(line: string): PaneEntry | undefined {
  try {
    const e = JSON.parse(line) as unknown;
    return e && typeof e === "object" ? (e as PaneEntry) : undefined;
  } catch {
    return undefined;
  }
}

/** What a scan of the project folder found besides the followed transcript. */
interface FolderScan {
  /** Transcripts written after the followed one, with what choosing a successor needs. */
  newer: Array<SuccessorCandidate & { file: string }>;
  /** The latest write of any other transcript in the folder. */
  maxOtherMtime: number;
}

/**
 * Backs the agent pane: follows the transcript of the session the agent
 * terminal started, turns it into {@link AgentPaneSnapshot}s and pushes what
 * changed. One follow at a time, and one service per connection (it holds
 * watchers and timers, which {@link dispose} releases).
 *
 * The transcript is found by session id under every Claude config dir (it
 * does not exist until Claude writes its first line, so the project folder is
 * watched, once, for it, and looked for with a backing-off poll), read
 * incrementally with the follow reader, and watched. When the conversation
 * moves to another transcript (`/clear`, `/resume`) the follow moves with it
 * and the client is told; the folder is listed for that only when it changed.
 * Updates arrive per transcript record, not as a token stream.
 */
export class AgentPaneBackendService implements AgentPaneService {
  private client: AgentPaneClient | undefined;
  private readonly deps: Required<Pick<AgentPaneDeps, "configDirs" | "now" | "watch" | "liveDirs" | "specPlan" | "debounceMs">> & { namesPath: string };
  private readonly lineage = new SessionLineage();
  private readonly counter: ToolCounter;
  private live: { at: number; value: Set<string> | null } | undefined;
  private specPlanCache: { workspace: string; at: number; dirMtime: number; value: PanePlanItem[] | undefined } | undefined;

  private binding: AgentPaneBinding | undefined;
  private transcript: string | undefined;
  private cursor: FollowCursor | undefined;
  private entries: PaneEntry[] = [];
  private raw: string[] = [];
  private last: AgentPaneSnapshot | undefined;
  private cwd: string | undefined;
  private fileWatcher: { close(): void } | undefined;
  private dirWatcher: { close(): void } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private locateTimer: ReturnType<typeof setTimeout> | undefined;
  private successorTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by every follow and stop, so a refresh begun for an earlier one drops its result. */
  private epoch = 0;
  private refreshing: Promise<void> | undefined;
  private again = false;
  /** The folder changed (its watcher fired) since the last scan for a successor. */
  private dirDirty = true;
  private dirMtime: number | undefined;
  private successorCheckedAt: number | undefined;
  /** The last scan saw transcripts newer than ours and chose none of them: look again soon. */
  private pendingCandidates = false;
  private maxOtherMtime = 0;
  private locateStartedAt = 0;
  private locateDelay = LOCATE_MS;

  constructor(deps: AgentPaneDeps = {}) {
    this.deps = {
      configDirs: deps.configDirs ?? (() => configDirs()),
      now: deps.now ?? Date.now,
      watch: deps.watch ?? defaultWatch,
      liveDirs: deps.liveDirs ?? (() => liveProjectDirs()),
      specPlan: deps.specPlan ?? readSpecPlan,
      debounceMs: deps.debounceMs ?? DEBOUNCE_MS,
      namesPath: deps.namesPath ?? resolveSessionNamesPath(),
    };
    this.counter = deps.counter ?? new ToolCounter();
  }

  setClient(client: AgentPaneClient): void {
    this.client = client;
  }

  async follow(binding: AgentPaneBinding): Promise<AgentPaneSnapshot | undefined> {
    // The id names a file under a Claude config dir and the path a folder to
    // look in: neither may carry anything but what Claude and the backend write.
    if (!SESSION_ID.test(binding.sessionId)) throw new Error("agent pane: the session id is not a UUID");
    if (!isAbsolute(binding.workspacePath) || normalize(binding.workspacePath).replace(/(.)[\\/]+$/, "$1") !== binding.workspacePath.replace(/(.)[\\/]+$/, "$1")) {
      throw new Error("agent pane: the workspace path is not an absolute, normalised path");
    }
    await this.stop();
    const epoch = ++this.epoch;
    this.binding = binding;
    this.locateStartedAt = this.deps.now();
    this.locateDelay = LOCATE_MS;
    await this.locate();
    if (epoch !== this.epoch) return undefined;
    if (!this.transcript) {
      this.scheduleLocate();
      return undefined;
    }
    await this.refresh();
    return this.last;
  }

  async stop(): Promise<void> {
    this.epoch++;
    for (const t of [this.timer, this.locateTimer, this.successorTimer]) if (t) clearTimeout(t);
    this.timer = this.locateTimer = this.successorTimer = undefined;
    this.fileWatcher?.close();
    this.dirWatcher?.close();
    this.fileWatcher = this.dirWatcher = undefined;
    this.binding = this.transcript = this.cursor = this.last = this.cwd = undefined;
    this.entries = [];
    this.raw = [];
    this.dirDirty = true;
    this.dirMtime = undefined;
    this.successorCheckedAt = undefined;
    this.pendingCandidates = false;
    this.maxOtherMtime = 0;
  }

  /** Stop, and let go of the client: the connection this service served has closed. */
  dispose(): void {
    void this.stop();
    this.client = undefined;
  }

  /** The projects folders to look in: the workspace's own folder in each account first. */
  private projectDirs(workspacePath: string): string[] {
    const encoded = encodeProjectDir(workspacePath);
    return this.deps.configDirs().map((dir) => join(projectsDirOf(dir), encoded));
  }

  /** Find the transcript by session id and attach to it; else arm the folder's watcher, once. */
  private async locate(): Promise<void> {
    const b = this.binding;
    if (!b || this.transcript) return;
    const real = await realpath(b.workspacePath).catch(() => b.workspacePath);
    const dirs = [...new Set([...this.projectDirs(b.workspacePath), ...this.projectDirs(real)])];
    for (const dir of dirs) {
      const file = join(dir, `${b.sessionId}.jsonl`);
      if (await stat(file).then(() => true, () => false)) {
        this.attach(file, dir);
        return;
      }
    }
    // Claude has not written its first line: the folder, once it exists, tells when it does.
    if (!this.dirWatcher) {
      for (const dir of dirs) {
        if (await stat(dir).then(() => true, () => false)) {
          this.armDirWatcher(dir);
          return;
        }
      }
    }
  }

  /** Poll for a transcript that is not there, slower each time, and give up after ten minutes. */
  private scheduleLocate(): void {
    if (this.locateTimer || this.deps.now() - this.locateStartedAt > LOCATE_GIVE_UP_MS) return;
    const epoch = this.epoch;
    this.locateTimer = setTimeout(() => {
      this.locateTimer = undefined;
      if (epoch !== this.epoch) return;
      this.locateDelay = Math.min(this.locateDelay * 2, LOCATE_MAX_MS);
      void this.locate()
        .then(() => (this.transcript ? this.refresh() : this.scheduleLocate()))
        .catch(() => undefined);
    }, this.locateDelay);
    this.locateTimer.unref?.();
  }

  private armDirWatcher(dir: string): void {
    if (this.dirWatcher) return;
    this.dirWatcher = this.deps.watch(dir, () => {
      this.dirDirty = true;
      this.schedule();
    });
  }

  private attach(file: string, dir: string): void {
    this.transcript = file;
    this.cursor = undefined;
    this.entries = [];
    this.raw = [];
    this.cwd = undefined;
    this.pendingCandidates = false;
    if (this.locateTimer) clearTimeout(this.locateTimer);
    this.locateTimer = undefined;
    this.fileWatcher?.close();
    this.fileWatcher = this.deps.watch(file, () => this.schedule());
    this.armDirWatcher(dir);
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh().catch(() => undefined);
    }, this.deps.debounceMs);
    this.timer.unref?.();
  }

  /**
   * Read what the transcript gained, push what changed, and move to the
   * successor transcript if the conversation did. Single-flight: a call made
   * while one runs is folded into one more run after it.
   */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }
    const run = (async () => {
      do {
        this.again = false;
        await this.refreshOnce();
      } while (this.again);
    })().finally(() => {
      this.refreshing = undefined;
    });
    this.refreshing = run;
    return run;
  }

  private async refreshOnce(): Promise<void> {
    const epoch = this.epoch;
    if (this.binding && !this.transcript) await this.locate();
    const b = this.binding;
    const file = this.transcript;
    if (!b || !file) return;
    const chunk = await readFollowChunk(file, this.cursor, TAIL_BYTES);
    if (epoch !== this.epoch) return;
    const restarted = this.cursor === undefined || (this.cursor && chunk.cursor && chunk.cursor.offset < this.cursor.offset);
    this.cursor = chunk.cursor;
    if (restarted) {
      this.entries = [];
      this.raw = [];
    }
    for (const line of chunk.lines) {
      const e = parse(line);
      if (!e) continue;
      this.entries.push(e);
      this.raw.push(line);
    }
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
      this.raw.splice(0, this.raw.length - MAX_ENTRIES);
    }

    const scan = await this.scanFolder(file);
    const next = await this.snapshot(b, file, epoch);
    const successor = scan ? await this.findSuccessor(b, file, scan) : undefined;
    if (epoch !== this.epoch) return;
    // Moving on: the old session's last picture (it is no longer the folder's newest) is not worth pushing.
    if (!successor) {
      const push = diffSnapshots(this.last, next);
      this.last = next;
      if (push?.kind === "snapshot") this.client?.onSnapshot(push.snapshot);
      else if (push) this.client?.onDelta(push.delta);
      return;
    }
    const from = b.sessionId;
    this.transcript = undefined;
    this.binding = { ...b, sessionId: successor.sessionId };
    this.last = undefined;
    this.attach(successor.file, successor.dir);
    this.client?.onSessionAdopted(from, successor.sessionId);
    this.again = true;
  }

  private async snapshot(b: AgentPaneBinding, file: string, epoch: number): Promise<AgentPaneSnapshot> {
    const parsed = parseTranscript(this.raw);
    this.cwd = parsed.cwd ?? this.cwd;
    const [names, liveDirs, mtimeMs] = await Promise.all([
      loadSessionNames(this.deps.namesPath),
      this.liveDirs(),
      stat(file).then((s) => s.mtimeMs, () => this.deps.now()),
    ]);
    const status = parsed.cwd
      ? classifySession(parsed.cwd, mtimeMs, mtimeMs >= this.maxOtherMtime, liveDirs, this.deps.now(), this.entries, parsed.permissionMode)
      : undefined;
    const title = names.get(b.sessionId) || b.title || parsed.goal.slice(0, 120) || undefined;
    const inputs = {
      sessionId: b.sessionId,
      ...(title ? { title } : {}),
      ...(status ? { state: status.state, needsYou: status.needsYou } : {}),
    };
    let snap = buildAgentPaneSnapshot(this.entries, inputs);
    // The spec's plan is the chain's last resort: read only when nothing in the transcript is a plan.
    if (!snap.plan) {
      const fallbackPlan = await this.specPlan(b.workspacePath);
      if (fallbackPlan) snap = buildAgentPaneSnapshot(this.entries, { ...inputs, fallbackPlan });
    }
    // The exact count is a scan of the whole file: the snapshot goes out with what the counter has, and the count follows as a delta.
    const known = this.counter.cached(file);
    if (known !== undefined) snap = { ...snap, toolCount: known };
    void this.counter.count(file).then((count) => {
      if (count !== known && epoch === this.epoch) this.schedule();
    });
    return snap;
  }

  /** The workspace's spec plan, read at most every few seconds and not at all while the folder is unchanged. */
  private async specPlan(workspace: string): Promise<PanePlanItem[] | undefined> {
    const now = this.deps.now();
    const dirMtime = await stat(join(workspace, "docs", "specs", ".context")).then((s) => s.mtimeMs, () => 0);
    const c = this.specPlanCache;
    if (c && c.workspace === workspace && c.dirMtime === dirMtime && now - c.at < SPEC_PLAN_TTL_MS) return c.value;
    const value = await this.deps.specPlan(workspace).catch(() => undefined);
    this.specPlanCache = { workspace, at: now, dirMtime, value };
    return value;
  }

  private async liveDirs(): Promise<Set<string> | null> {
    const now = this.deps.now();
    if (this.live && now - this.live.at < LIVE_TTL_MS) return this.live.value;
    const value = await this.deps.liveDirs();
    this.live = { at: now, value };
    return value;
  }

  /**
   * List the project folder for transcripts written after ours, only when it
   * may have changed: its watcher fired, its own mtime moved, or the last scan
   * left a newer transcript undecided. At most once per few seconds; a scan
   * wanted sooner is deferred to a timer that is cleared with the follow.
   */
  private async scanFolder(file: string): Promise<FolderScan | undefined> {
    const dir = join(file, "..");
    const dirMtime = await stat(dir).then((s) => s.mtimeMs, () => undefined);
    const changed = this.dirDirty || dirMtime !== this.dirMtime || this.pendingCandidates;
    if (!changed) return undefined;
    const now = this.deps.now();
    const wait = (this.successorCheckedAt ?? -Infinity) + SUCCESSOR_EVERY_MS - now;
    if (wait > 0) {
      if (!this.successorTimer) {
        this.successorTimer = setTimeout(() => {
          this.successorTimer = undefined;
          this.schedule();
        }, wait);
        this.successorTimer.unref?.();
      }
      return undefined;
    }
    this.successorCheckedAt = now;
    this.dirDirty = false;
    this.dirMtime = dirMtime;
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl"));
    } catch {
      return undefined;
    }
    const ownId = file.slice(dir.length + 1, -".jsonl".length);
    const ownMtime = await stat(file).then((s) => s.mtimeMs, () => 0);
    const newer: FolderScan["newer"] = [];
    let maxOther = 0;
    for (const name of names) {
      const sessionId = name.slice(0, -".jsonl".length);
      if (sessionId === ownId) continue;
      const path = join(dir, name);
      const mtimeMs = await stat(path).then((s) => s.mtimeMs, () => 0);
      maxOther = Math.max(maxOther, mtimeMs);
      if (mtimeMs <= ownMtime) continue;
      const root = await readRoot(path);
      newer.push({ sessionId, mtimeMs, file: path, ...(root?.atMs !== undefined ? { firstAtMs: root.atMs } : {}), ...(root ? { rootUuid: root.uuid } : {}) });
    }
    this.maxOtherMtime = maxOther;
    return { newer, maxOtherMtime: maxOther };
  }

  /** The transcript the conversation moved to, among those the scan found newer than ours. */
  private async findSuccessor(b: AgentPaneBinding, file: string, scan: FolderScan): Promise<{ sessionId: string; file: string; dir: string } | undefined> {
    const dir = join(file, "..");
    this.pendingCandidates = scan.newer.length > 0;
    if (scan.newer.length === 0) return undefined;
    // A stored id may be a session that ended long ago: a newer transcript is its successor only while Claude runs in the folder.
    if (b.fromStorage) {
      const live = await this.liveDirs();
      if (!live || !this.cwd || !live.has(this.cwd)) return undefined;
    }
    const ownMtime = await stat(file).then((s) => s.mtimeMs, () => 0);
    const own = await readRoot(file);
    const lastAtMs = this.lastEntryMs();
    const nodes: LineageNode[] = [
      lineageNode(b.sessionId, file, ownMtime, this.entries),
      ...(await Promise.all(scan.newer.map(async (c) => lineageNode(c.sessionId, c.file, c.mtimeMs, (await tailEntries(c.file)) as unknown[])))),
    ];
    const superseded = await this.lineage.superseded(nodes);
    const chosen = chooseSuccessor(
      { sessionId: b.sessionId, ...(lastAtMs !== undefined ? { lastAtMs } : {}), ...(own ? { rootUuid: own.uuid } : {}) },
      superseded,
      scan.newer,
    );
    const found = scan.newer.find((c) => c.sessionId === chosen);
    if (found) this.pendingCandidates = false;
    return found ? { sessionId: found.sessionId, file: found.file, dir } : undefined;
  }

  private lastEntryMs(): number | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const ms = this.entries[i]!.timestamp ? Date.parse(this.entries[i]!.timestamp!) : NaN;
      if (!Number.isNaN(ms)) return ms;
    }
    return undefined;
  }
}

/** The last lines of a transcript, parsed: enough for its tip uuid. */
async function tailEntries(path: string): Promise<PaneEntry[]> {
  const { lines } = await readFollowChunk(path, undefined, 64 << 10);
  return lines.map(parse).filter((e): e is PaneEntry => !!e);
}
