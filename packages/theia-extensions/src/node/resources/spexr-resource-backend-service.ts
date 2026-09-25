import { injectable, unmanaged } from "@theia/core/shared/inversify";
import { execFile } from "node:child_process";
import type { ResourceUsage, SpexrResourceService } from "../../common/resource-protocol.js";
import { PS_ARGS, parsePs, summarizeTree } from "./process-tree.js";

/** A sample younger than this is served from cache, so several windows share one `ps`. */
export const SAMPLE_MS = 2_000;

/** Gap between the two samples of the very first call, so it already has a CPU figure. */
const FIRST_GAP_MS = 750;

export interface ResourceServiceDeps {
  readonly runPs: () => Promise<string>;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly rootPid: number;
  readonly backendPid: number;
  readonly platform: NodeJS.Platform;
}

/**
 * Samples SPEXR's process tree with `ps` and reports memory and CPU per group.
 *
 * The tree starts at Electron's main process when the backend was forked by
 * it (it then has an IPC channel), and at the backend itself otherwise, so a
 * dev launch from a shell does not count the shell. CPU is the CPU time used
 * between two samples, so it needs a previous one; the first call takes two.
 * Windows has no `ps`; there `usage()` answers undefined.
 */
@injectable()
export class SpexrResourceBackendService implements SpexrResourceService {
  private readonly deps: ResourceServiceDeps;
  private last: { at: number; usage: ResourceUsage | undefined } | undefined;
  private inflight: Promise<ResourceUsage | undefined> | undefined;
  private previousCpu = new Map<number, number>();
  private previousAt: number | undefined;

  constructor(@unmanaged() deps: Partial<ResourceServiceDeps> = {}) {
    this.deps = {
      runPs: deps.runPs ?? runPs,
      now: deps.now ?? Date.now,
      sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      rootPid: deps.rootPid ?? (typeof process.send === "function" ? process.ppid : process.pid),
      backendPid: deps.backendPid ?? process.pid,
      platform: deps.platform ?? process.platform,
    };
  }

  async usage(): Promise<ResourceUsage | undefined> {
    if (this.deps.platform === "win32") return undefined;
    if (this.last && this.deps.now() - this.last.at < SAMPLE_MS) return this.last.usage;
    this.inflight ??= this.measure().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /** Take a sample (two on the first call), cache it, and answer undefined if `ps` fails. */
  private async measure(): Promise<ResourceUsage | undefined> {
    try {
      if (this.previousAt === undefined) {
        await this.sample();
        await this.deps.sleep(FIRST_GAP_MS);
      }
      const usage = await this.sample();
      this.last = { at: this.deps.now(), usage };
      return usage;
    } catch {
      this.last = { at: this.deps.now(), usage: undefined };
      return undefined;
    }
  }

  /** Run `ps` once, summarise against the previous sample, and keep this one's CPU times. */
  private async sample(): Promise<ResourceUsage> {
    const rows = parsePs(await this.deps.runPs());
    const at = this.deps.now();
    const elapsed = this.previousAt === undefined ? 0 : (at - this.previousAt) / 1000;
    const usage = summarizeTree(rows, this.deps, this.previousCpu, elapsed);
    this.previousCpu = new Map(rows.map((r) => [r.pid, r.cpuSeconds]));
    this.previousAt = at;
    return usage;
  }
}

function runPs(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("ps", PS_ARGS, { timeout: 3000, maxBuffer: 16 << 20 }, (err, stdout) => {
      if (err && !stdout) reject(err);
      else resolve(stdout);
    });
  });
}
