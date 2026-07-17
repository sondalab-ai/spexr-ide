import { injectable, inject, optional } from "@theia/core/shared/inversify";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { DescriptionGeneratorToken, type DescriptionGenerator } from "../search/description-format.js";
import { parseTranscript } from "./transcript-parser.js";
import { classifyState } from "./liveness.js";
import { openTranscriptPaths as defaultOpenTranscriptPaths } from "./open-transcripts.js";
import { buildTurnsText, type TurnEntry } from "./turns.js";
import type {
  AgentSession, AgentSummary, SpexrDarkfactoryService, SpexrDarkfactoryClient,
} from "../../common/darkfactory-protocol.js";

const IDLE_WINDOW_MS = 12 * 3_600_000;
const SUMMARY_TURNS = 6;

/** One transcript file discovered on disk; `readLines` is lazy. */
export interface TranscriptRef {
  sessionId: string;
  transcriptPath: string;
  mtimeMs: number;
  readLines(): Promise<string[]>;
}

/** Constructor seams so the service is unit-testable without a real home dir. */
export interface DarkfactoryDeps {
  projectsDir?: string;
  now?: () => number;
  idleWindowMs?: number;
  listTranscripts?: () => Promise<TranscriptRef[]>;
  openTranscriptPaths?: (projectsDir: string) => Promise<Set<string> | null>;
  generator?: DescriptionGenerator;
}

@injectable()
export class SpexrDarkfactoryBackendService implements SpexrDarkfactoryService {
  private readonly projectsDir: string;
  private readonly now: () => number;
  private readonly idleWindowMs: number;
  private readonly listTranscripts: () => Promise<TranscriptRef[]>;
  private readonly openPaths: (projectsDir: string) => Promise<Set<string> | null>;
  private readonly generator: DescriptionGenerator;

  private client?: SpexrDarkfactoryClient;
  private watcher?: FSWatcher;
  /** sessionId → { transcriptPath, mtimeMs, lastPrompt } from the last scan. */
  private readonly index = new Map<string, { transcriptPath: string; mtimeMs: number; lastPrompt: string }>();
  /** sessionId → { mtimeMs, summary } cache. */
  private readonly summaryCache = new Map<string, { mtimeMs: number; summary: AgentSummary }>();
  /** Project paths seen during the last scan; guards `revealInFileManager` against arbitrary RPC-supplied paths. */
  private readonly knownProjects = new Set<string>();

  // @inject via DI in production; the object form is used by tests.
  constructor(
    @inject(DescriptionGeneratorToken) @optional() deps?: DescriptionGenerator | DarkfactoryDeps,
  ) {
    const d: DarkfactoryDeps = isGenerator(deps) ? { generator: deps } : (deps ?? {});
    this.projectsDir = d.projectsDir ?? join(homedir(), ".claude", "projects");
    this.now = d.now ?? Date.now;
    this.idleWindowMs = d.idleWindowMs ?? IDLE_WINDOW_MS;
    this.generator = d.generator ?? nullGenerator();
    this.openPaths = d.openTranscriptPaths ?? ((dir) => defaultOpenTranscriptPaths(dir));
    this.listTranscripts = d.listTranscripts ?? (() => this.scanDisk());
  }

  setClient(client: SpexrDarkfactoryClient): void {
    this.client = client;
    this.ensureWatching();
  }

  async listAgents(includeArchived = false): Promise<AgentSession[]> {
    const [refs, open] = await Promise.all([
      this.listTranscripts(),
      this.openPaths(this.projectsDir),
    ]);
    const now = this.now();
    const agents: AgentSession[] = [];
    this.index.clear();
    this.knownProjects.clear();
    for (const ref of refs) {
      const parsed = parseTranscript(await ref.readLines());
      if (!parsed.cwd) continue; // no real project path → skip
      const state = classifyState(ref.transcriptPath, ref.mtimeMs, open, now, this.idleWindowMs);
      this.index.set(ref.sessionId, { transcriptPath: ref.transcriptPath, mtimeMs: ref.mtimeMs, lastPrompt: parsed.lastPrompt });
      this.knownProjects.add(parsed.cwd);
      if (state === "archived" && !includeArchived) continue;
      agents.push({
        sessionId: ref.sessionId, transcriptPath: ref.transcriptPath,
        projectPath: parsed.cwd, projectName: basename(parsed.cwd),
        state, lastActivityMs: ref.mtimeMs,
        turnCount: parsed.userTurns, lastPrompt: parsed.lastPrompt,
        ...(parsed.gitBranch !== undefined ? { gitBranch: parsed.gitBranch } : {}),
        ...(parsed.lastTool !== undefined ? { lastTool: parsed.lastTool } : {}),
        ...(parsed.mode !== undefined ? { mode: parsed.mode } : {}),
        ...(parsed.permissionMode !== undefined ? { permissionMode: parsed.permissionMode } : {}),
      });
    }
    return sortAgents(agents);
  }

  async summarize(sessionId: string): Promise<AgentSummary> {
    const meta = this.index.get(sessionId);
    if (!meta) return { sessionId, text: "", fromModel: false };
    const cached = this.summaryCache.get(sessionId);
    if (cached && cached.mtimeMs === meta.mtimeMs) return cached.summary;

    let summary: AgentSummary = { sessionId, text: meta.lastPrompt, fromModel: false };
    if (this.generator.isAvailable()) {
      const lines = await readFileLines(meta.transcriptPath);
      const entries = lines.map(parseLine).filter((e): e is TurnEntry => !!e);
      const text = await this.generator.summarize(buildTurnsText(entries, SUMMARY_TURNS));
      if (text) summary = { sessionId, text, fromModel: true };
    }
    this.summaryCache.set(sessionId, { mtimeMs: meta.mtimeMs, summary });
    return summary;
  }

  async revealInFileManager(projectPath: string): Promise<void> {
    // Guard against spawning a file-manager process on an arbitrary RPC-supplied path:
    // only reveal paths this service actually discovered during a scan.
    if (!this.knownProjects.has(projectPath)) return;
    const { execFile } = await import("node:child_process");
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    await new Promise<void>((resolve) => execFile(cmd, [projectPath], () => resolve()));
  }

  private ensureWatching(): void {
    if (this.watcher) return;
    try {
      // NOTE: `recursive: true` is only implemented on macOS and Windows in Node's fs.watch;
      // on Linux it throws synchronously, which is swallowed by the catch below. Live
      // push-refresh is therefore inert on Linux — the widget still works via its own
      // `listAgents` calls, it just won't auto-refresh on file changes there.
      this.watcher = watch(this.projectsDir, { recursive: true }, debounce(async () => {
        try {
          this.client?.onAgentsChanged(await this.listAgents());
        } catch {
          // ignore: a failed rescan on a watch event isn't worth surfacing to the user.
        }
      }, 400));
    } catch { /* directory missing (or platform lacks recursive watch, e.g. Linux) → nothing to watch */ }
  }

  private async scanDisk(): Promise<TranscriptRef[]> {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(this.projectsDir);
    } catch {
      return []; // ~/.claude/projects missing
    }
    const refs: TranscriptRef[] = [];
    for (const dir of projectDirs) {
      const full = join(this.projectsDir, dir);
      let files: string[];
      try { files = await readdir(full); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const transcriptPath = join(full, f);
        let mtimeMs: number;
        try { mtimeMs = (await stat(transcriptPath)).mtimeMs; } catch { continue; }
        refs.push({
          sessionId: f.replace(/\.jsonl$/, ""), transcriptPath, mtimeMs,
          readLines: () => readFileLines(transcriptPath),
        });
      }
    }
    return refs;
  }

  dispose(): void {
    this.watcher?.close();
  }
}

function isGenerator(x: unknown): x is DescriptionGenerator {
  return !!x && typeof (x as DescriptionGenerator).summarize === "function" && typeof (x as DescriptionGenerator).isAvailable === "function";
}

function nullGenerator(): DescriptionGenerator {
  return { generate: () => Promise.resolve(null), summarize: () => Promise.resolve(null), isAvailable: () => false };
}

function parseLine(line: string): TurnEntry | undefined {
  try { return JSON.parse(line) as TurnEntry; } catch { return undefined; }
}

async function readFileLines(path: string): Promise<string[]> {
  try { return (await readFile(path, "utf8")).split("\n"); } catch { return []; }
}

/** Live first, then most-recently-active first. */
export function sortAgents(agents: AgentSession[]): AgentSession[] {
  const rank = { live: 0, idle: 1, archived: 2 } as const;
  return [...agents].sort((a, b) => rank[a.state] - rank[b.state] || b.lastActivityMs - a.lastActivityMs);
}

function debounce<T extends (...a: never[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...a: Parameters<T>) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...a), ms); }) as T;
}
