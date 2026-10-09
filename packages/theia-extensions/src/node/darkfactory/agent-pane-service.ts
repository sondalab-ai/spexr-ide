import { watch, type FSWatcher } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
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
const LIVE_TTL_MS = 5000;
/** The project folder is listed for a successor at most this often: it can hold thousands of transcripts. */
const SUCCESSOR_EVERY_MS = 3000;

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

/**
 * Backs the agent pane: follows the transcript of the session the agent
 * terminal started, turns it into {@link AgentPaneSnapshot}s and pushes what
 * changed. One follow at a time.
 *
 * The transcript is found by session id under every Claude config dir (it
 * does not exist until Claude writes its first line, so the project folder is
 * watched for it), read incrementally with the follow reader, and watched. When
 * the conversation moves to another transcript (`/clear`, `/resume`) the
 * follow moves with it and the client is told. Updates arrive per transcript
 * record, not as a token stream.
 */
export class AgentPaneBackendService implements AgentPaneService {
  private client: AgentPaneClient | undefined;
  private readonly deps: Required<Pick<AgentPaneDeps, "configDirs" | "now" | "watch" | "liveDirs" | "specPlan" | "debounceMs">> & { namesPath: string };
  private readonly lineage = new SessionLineage();
  private readonly counter = new ToolCounter();
  private live: { at: number; value: Set<string> | null } | undefined;

  private binding: AgentPaneBinding | undefined;
  private transcript: string | undefined;
  private cursor: FollowCursor | undefined;
  private entries: PaneEntry[] = [];
  private raw: string[] = [];
  private last: AgentPaneSnapshot | undefined;
  private watchers: Array<{ close(): void }> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private locating: ReturnType<typeof setInterval> | undefined;
  /** Bumped by every follow and stop, so a refresh begun for an earlier one drops its result. */
  private epoch = 0;
  private refreshing: Promise<void> | undefined;
  private again = false;
  private successorCheckedAt: number | undefined;

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
  }

  setClient(client: AgentPaneClient): void {
    this.client = client;
  }

  async follow(binding: AgentPaneBinding): Promise<AgentPaneSnapshot | undefined> {
    await this.stop();
    const epoch = ++this.epoch;
    this.binding = binding;
    await this.locate();
    if (epoch !== this.epoch) return undefined;
    if (!this.transcript) {
      this.locating = setInterval(() => void this.locate().then(() => this.transcript && this.schedule()).catch(() => undefined), LOCATE_MS);
      this.locating.unref?.();
      return undefined;
    }
    await this.refresh();
    return this.last;
  }

  async stop(): Promise<void> {
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    if (this.locating) clearInterval(this.locating);
    this.timer = this.locating = undefined;
    for (const w of this.watchers.splice(0)) w.close();
    this.binding = this.transcript = this.cursor = this.last = undefined;
    this.entries = [];
    this.raw = [];
  }

  /** The projects folders to look in: the workspace's own folder in each account first. */
  private projectDirs(workspacePath: string): string[] {
    const encoded = encodeProjectDir(workspacePath);
    return this.deps.configDirs().map((dir) => join(projectsDirOf(dir), encoded));
  }

  /** Find the transcript by session id, arm the watchers when found. */
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
    // Claude has not written its first line: the folder, when it exists, tells when it does.
    for (const dir of dirs) {
      if (await stat(dir).then(() => true, () => false)) {
        const w = this.deps.watch(dir, () => this.schedule());
        if (w) this.watchers.push(w);
        return;
      }
    }
  }

  private attach(file: string, dir: string): void {
    this.transcript = file;
    this.cursor = undefined;
    this.entries = [];
    this.raw = [];
    for (const w of this.watchers.splice(0)) w.close();
    if (this.locating) clearInterval(this.locating);
    this.locating = undefined;
    for (const path of [file, dir]) {
      const w = this.deps.watch(path, () => this.schedule());
      if (w) this.watchers.push(w);
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh().catch(() => undefined), this.deps.debounceMs);
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

    const next = await this.snapshot(b, file);
    if (epoch !== this.epoch) return;
    const push = diffSnapshots(this.last, next);
    this.last = next;
    if (push?.kind === "snapshot") this.client?.onSnapshot(push.snapshot);
    else if (push) this.client?.onDelta(push.delta);

    const successor = await this.findSuccessor(b, file);
    if (epoch !== this.epoch || !successor) return;
    const from = b.sessionId;
    this.transcript = undefined;
    this.binding = { ...b, sessionId: successor.sessionId };
    this.last = undefined;
    this.attach(successor.file, successor.dir);
    this.client?.onSessionAdopted(from, successor.sessionId);
    this.again = true;
  }

  private async snapshot(b: AgentPaneBinding, file: string): Promise<AgentPaneSnapshot> {
    const parsed = parseTranscript(this.raw);
    const [names, liveDirs, fallbackPlan, mtimeMs, toolCount] = await Promise.all([
      loadSessionNames(this.deps.namesPath),
      this.liveDirs(),
      this.deps.specPlan(b.workspacePath).catch(() => undefined),
      stat(file).then((s) => s.mtimeMs, () => this.deps.now()),
      this.counter.count(file),
    ]);
    const status = parsed.cwd
      ? classifySession(parsed.cwd, mtimeMs, true, liveDirs, this.deps.now(), this.entries, parsed.permissionMode)
      : undefined;
    const title = names.get(b.sessionId) || b.title || parsed.goal.slice(0, 120) || undefined;
    const snap = buildAgentPaneSnapshot(this.entries, {
      sessionId: b.sessionId,
      ...(title ? { title } : {}),
      ...(status ? { state: status.state, needsYou: status.needsYou } : {}),
      ...(fallbackPlan ? { fallbackPlan } : {}),
    });
    return toolCount !== undefined ? { ...snap, toolCount } : snap;
  }

  private async liveDirs(): Promise<Set<string> | null> {
    const now = this.deps.now();
    if (this.live && now - this.live.at < LIVE_TTL_MS) return this.live.value;
    const value = await this.deps.liveDirs();
    this.live = { at: now, value };
    return value;
  }

  /** Look for the transcript the conversation moved to, only when another has been written since. */
  private async findSuccessor(b: AgentPaneBinding, file: string): Promise<{ sessionId: string; file: string; dir: string } | undefined> {
    const wait = (this.successorCheckedAt ?? -Infinity) + SUCCESSOR_EVERY_MS - this.deps.now();
    if (wait > 0) {
      const t = setTimeout(() => this.schedule(), wait);
      t.unref?.();
      return undefined;
    }
    this.successorCheckedAt = this.deps.now();
    const dir = join(file, "..");
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl"));
    } catch {
      return undefined;
    }
    const ownMtime = await stat(file).then((s) => s.mtimeMs, () => 0);
    const newer: Array<SuccessorCandidate & { file: string }> = [];
    for (const name of names) {
      const sessionId = name.slice(0, -".jsonl".length);
      if (sessionId === b.sessionId) continue;
      const path = join(dir, name);
      const mtimeMs = await stat(path).then((s) => s.mtimeMs, () => 0);
      if (mtimeMs <= ownMtime) continue;
      const root = await readRoot(path);
      newer.push({ sessionId, mtimeMs, file: path, ...(root?.atMs !== undefined ? { firstAtMs: root.atMs } : {}), ...(root ? { rootUuid: root.uuid } : {}) });
    }
    if (newer.length === 0) return undefined;

    const own = await readRoot(file);
    const lastAtMs = this.lastEntryMs();
    const nodes: LineageNode[] = [
      lineageNode(b.sessionId, file, ownMtime, this.entries),
      ...(await Promise.all(newer.map(async (c) => lineageNode(c.sessionId, c.file, c.mtimeMs, (await tailEntries(c.file)) as unknown[])))),
    ];
    const superseded = await this.lineage.superseded(nodes);
    const chosen = chooseSuccessor(
      { sessionId: b.sessionId, ...(lastAtMs !== undefined ? { lastAtMs } : {}), ...(own ? { rootUuid: own.uuid } : {}) },
      superseded,
      newer,
    );
    const found = newer.find((c) => c.sessionId === chosen);
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
