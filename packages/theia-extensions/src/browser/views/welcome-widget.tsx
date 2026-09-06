import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
import { CommandService } from "@theia/core/lib/common/command";
import { ApplicationServer } from "@theia/core/lib/common/application-protocol";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { type FileOperationEvent } from "@theia/filesystem/lib/common/files";
import type URI from "@theia/core/lib/common/uri";
import { WELCOME_VIEW_ID } from "./welcome-view-contribution.js";
import { WelcomeSplash } from "./welcome-splash.js";
import { WelcomeBackground } from "./welcome-background.js";
import { specsDir } from "../workspace-paths.js";
import { fetchReleaseNotes } from "../release-notes-source.js";
import type { ReleaseNote } from "../../common/changelog.js";

/** Matches a spec file name (`NNNN-<slug>.md`). */
const SPEC_FILE_RE = /^\d{4}-[a-z0-9][a-z0-9-]*\.md$/;

@injectable()
export class SpexrWelcomeWidget extends ReactWidget {
  static readonly ID = WELCOME_VIEW_ID;

  @inject(CommandService)
  private readonly commands!: CommandService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(ApplicationServer)
  private readonly applicationServer!: ApplicationServer;

  private emptyProject = false;
  private releaseNote: ReleaseNote | undefined;
  private releaseNotePending = false;

  constructor() {
    super();
    this.id = SpexrWelcomeWidget.ID;
    this.title.label = "Welcome";
    this.title.caption = "SPEXR — getting started";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-rocket";
    this.addClass("spexr-welcome-widget");
    this.node.setAttribute("aria-label", "Spexr welcome");
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(this.workspace.onWorkspaceChanged(() => void this.refresh()));
    this.toDispose.push(
      this.fileService.onDidRunOperation((event) => {
        if (this.affectsSpecs(event)) void this.refresh();
      }),
    );
    void this.refresh();
    void this.loadReleaseNote();
    this.update();
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    void this.refresh();
    // Retries a fetch that failed earlier (e.g. the app started offline).
    void this.loadReleaseNote();
    this.update();
  }

  /**
   * Loads the "What's new" entry from the changelog published on GitHub. On any
   * failure the panel stays hidden rather than showing notes bundled at build
   * time; the next attach retries.
   */
  private async loadReleaseNote(): Promise<void> {
    if (this.releaseNote !== undefined || this.releaseNotePending) return;
    this.releaseNotePending = true;
    try {
      const info = await this.applicationServer.getApplicationInfo().catch(() => undefined);
      const notes = await fetchReleaseNotes(info?.version);
      if (this.isDisposed || notes.length === 0) return;
      this.releaseNote = notes[0];
      this.update();
    } finally {
      this.releaseNotePending = false;
    }
  }

  private workspaceRoot(): URI | undefined {
    return this.workspace.tryGetRoots()[0]?.resource;
  }

  private affectsSpecs(event: FileOperationEvent): boolean {
    const root = this.workspaceRoot();
    if (!root) return false;
    const specsRoot = specsDir(root).toString() + "/";
    const candidates = [event.resource, event.target?.resource].filter(
      (u): u is URI => u !== undefined,
    );
    return candidates.some((uri) => uri.toString().startsWith(specsRoot));
  }

  /** Recompute whether the open workspace has no specs yet. */
  private async refresh(): Promise<void> {
    const next = await this.computeEmptyProject();
    if (next !== this.emptyProject) {
      this.emptyProject = next;
      this.update();
    }
  }

  private async computeEmptyProject(): Promise<boolean> {
    const root = this.workspaceRoot();
    if (!root) return false;
    try {
      const stat = await this.fileService.resolve(specsDir(root));
      return !(stat.children ?? []).some((c) => c.isFile && SPEC_FILE_RE.test(c.name));
    } catch {
      return true;
    }
  }

  protected render(): React.ReactNode {
    return (
      <>
        <WelcomeBackground />
        <WelcomeSplash
          emptyProject={this.emptyProject}
          releaseNote={this.releaseNote}
          onNewProject={() => this.commands.executeCommand("spexr.project.new")}
          onOpenFolder={() => this.commands.executeCommand("workspace:openFolder")}
          onFocusAgent={() => this.commands.executeCommand("spexr.claude.focus")}
          onStartFirstSpec={() => this.commands.executeCommand("spexr.spec.create")}
        />
      </>
    );
  }
}
