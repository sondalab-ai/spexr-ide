import { injectable, inject } from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import URI from "@theia/core/lib/common/uri";
import { SpexrDarkfactoryServiceProxy, type SpexrDarkfactoryService } from "../darkfactory/darkfactory-service-proxy.js";
import { buildProjectTargets, normalizeProjectPath, type ProjectTarget } from "./project-switch-targets.js";
import { rememberProjectLanding } from "./project-landing-intent.js";

/**
 * Jumps the window from one SPEXR project to another.
 *
 * Darkfactory is the machine-wide dashboard; every session on it belongs to a
 * project that is not necessarily the loaded one. This service turns "that
 * session's project" into a workspace switch, and records the landing intent so
 * the window comes back on a project tab rather than on the dashboard.
 */
@injectable()
export class SpexrProjectSwitchService {
  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(SpexrDarkfactoryServiceProxy)
  private readonly darkfactory!: SpexrDarkfactoryService;

  /** The loaded project root as a filesystem path, or undefined with no workspace open. */
  currentProjectPath(): string | undefined {
    const root = this.workspace.tryGetRoots()[0]?.resource;
    return root ? normalizeProjectPath(root.path.toString()) : undefined;
  }

  /** Whether `projectPath` is the project this window has loaded. */
  isCurrentProject(projectPath: string): boolean {
    const current = this.currentProjectPath();
    return current !== undefined && normalizeProjectPath(projectPath) === current;
  }

  /**
   * Projects the user can jump to: the ones with a session on the wall first,
   * then Theia's recent workspaces. A failed session scan degrades to the
   * recents alone rather than to an empty picker.
   */
  async listTargets(): Promise<ProjectTarget[]> {
    const [recents, tiles] = await Promise.all([
      this.workspace.recentWorkspaces().catch((): string[] => []),
      this.darkfactory.listTiles().catch(() => []),
    ]);
    const recentPaths = recents.map((uri) => new URI(uri).path.toString());
    return buildProjectTargets(recentPaths, tiles, this.currentProjectPath());
  }

  /**
   * Load `projectPath` as the workspace. No-op when it is already loaded, so a
   * stray click does not cost a window reload.
   *
   * `workspace.open` is called without options on purpose: the desktop app sets
   * `workspace.preserveWindow: true`, so Theia reloads this window in place.
   */
  switchTo(projectPath: string): void {
    const path = normalizeProjectPath(projectPath);
    if (!path || this.isCurrentProject(path)) return;
    rememberProjectLanding(localStorage, path);
    this.workspace.open(URI.fromFilePath(path));
  }
}
