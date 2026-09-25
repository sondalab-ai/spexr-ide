/**
 * SPEXR's own resource consumption, summed over its process tree: Electron
 * (main, renderers, GPU), the backend, the local model workers it forks, and
 * the terminals and agents it runs.
 */

export const RESOURCE_SERVICE_PATH = "/services/spexr/resources";

/** One slice of the tree. `cpuPercent` is per core: 100 is one core fully busy. */
export interface ResourceGroup {
  readonly rssBytes: number;
  readonly cpuPercent: number;
  readonly processes: number;
}

export interface ResourceUsage {
  readonly total: ResourceGroup;
  /** Electron and the backend. */
  readonly app: ResourceGroup;
  /** The forked search and decision model workers. */
  readonly models: ResourceGroup;
  /** Everything else under the backend: shells, agents, and what they run. */
  readonly terminals: ResourceGroup;
}

export interface SpexrResourceService {
  /** The latest sample, or undefined where it cannot be measured (no `ps`). */
  usage(): Promise<ResourceUsage | undefined>;
}
