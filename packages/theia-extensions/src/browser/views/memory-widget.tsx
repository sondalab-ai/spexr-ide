import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
import { CommandService } from "@theia/core/lib/common/command";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { type FileOperationEvent } from "@theia/filesystem/lib/common/files";
import type URI from "@theia/core/lib/common/uri";
import { MEMORY_VIEW_ID } from "./memory-view-contribution.js";
import { SpexrCommands } from "../commands/spexr-commands-contribution.js";
import { ClaudeTerminalManager } from "../agent/claude-terminal-manager.js";
import type { MemoryLinkStatus } from "../../common/agent-protocol.js";
import { memoryDir } from "../workspace-paths.js";

const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
type MemoryType = (typeof MEMORY_TYPES)[number];

interface MemoryEntry {
  readonly uri: string;
  readonly filename: string;
  readonly name: string;
  readonly description: string;
  readonly type: MemoryType | "unknown";
}

interface MemoryPanelProps {
  readonly entries: readonly MemoryEntry[];
  readonly hasWorkspace: boolean;
  readonly linkStatus: MemoryLinkStatus;
  readonly onAdd: () => void;
  readonly onOpen: (uri: string) => void;
  readonly onDelete: (uri: string) => void;
  readonly onRefresh: () => void;
  readonly onLink: () => void;
  readonly onUnlink: () => void;
  readonly onResolveConflict: () => void;
}

const LINK_BADGE: Record<MemoryLinkStatus, { label: string; className: string }> = {
  linked: { label: "Linked", className: "sl-badge sl-badge--success" },
  "already-linked": { label: "Linked", className: "sl-badge sl-badge--success" },
  unlinked: { label: "Not linked", className: "sl-tag sl-tag--plain" },
  "not-linked": { label: "Not linked", className: "sl-tag sl-tag--plain" },
  blocked: { label: "Conflict", className: "sl-badge sl-badge--danger" },
  error: { label: "Error", className: "sl-badge sl-badge--danger" },
  unknown: { label: "Unknown", className: "sl-tag sl-tag--plain" },
};

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const FIELD_RE = /^(name|description|type):\s*(.+)$/;

@injectable()
export class SpexrMemoryWidget extends ReactWidget {
  static readonly ID = MEMORY_VIEW_ID;

  @inject(CommandService)
  private readonly commands!: CommandService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(ClaudeTerminalManager)
  private readonly terminalManager!: ClaudeTerminalManager;

  private entries: readonly MemoryEntry[] = [];
  private linkStatus: MemoryLinkStatus = "unknown";

  constructor() {
    super();
    this.id = SpexrMemoryWidget.ID;
    this.title.label = "Memory";
    this.title.caption = "Browse and manage SPEXR memory";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-database";
    this.addClass("spexr-memory-widget");
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(this.workspace.onWorkspaceChanged(() => void this.refreshEntries()));
    this.toDispose.push(
      this.fileService.onDidRunOperation((event) => {
        if (this.affectsMemory(event)) void this.refreshEntries();
      }),
    );
    void this.refreshEntries();
    this.update();
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.update();
  }

  private affectsMemory(event: FileOperationEvent): boolean {
    const root = this.workspaceRoot();
    if (!root) return false;
    const memoryRoot = memoryDir(root).toString() + "/";
    const candidates = [event.resource, event.target?.resource].filter(
      (u): u is URI => u !== undefined,
    );
    return candidates.some(
      (uri) =>
        uri.toString().startsWith(memoryRoot) &&
        uri.path.base.endsWith(".md") &&
        uri.path.base !== "MEMORY.md",
    );
  }

  private async refreshEntries(): Promise<void> {
    this.entries = await this.loadEntries();
    const root = this.workspaceRoot();
    this.linkStatus = root
      ? await this.terminalManager.memoryLinkStatus(root.path.toString())
      : "unknown";
    this.update();
  }

  private async loadEntries(): Promise<readonly MemoryEntry[]> {
    const root = this.workspaceRoot();
    if (!root) return [];
    const memDir = memoryDir(root);
    try {
      const stat = await this.fileService.resolve(memDir);
      const items: MemoryEntry[] = [];
      for (const child of stat.children ?? []) {
        if (!child.isFile) continue;
        if (!child.name.endsWith(".md")) continue;
        if (child.name === "MEMORY.md") continue;
        items.push(await this.readEntry(child.resource));
      }
      return items.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  private async readEntry(uri: URI): Promise<MemoryEntry> {
    const fallback: MemoryEntry = {
      uri: uri.toString(),
      filename: uri.path.base,
      name: uri.path.base.replace(/\.md$/, ""),
      description: "",
      type: "unknown",
    };
    try {
      const file = await this.fileService.read(uri);
      const match = file.value.match(FRONTMATTER_RE);
      if (!match) return fallback;
      const fields: Record<string, string> = {};
      for (const line of (match[1] ?? "").split("\n")) {
        const fieldMatch = line.match(FIELD_RE);
        if (fieldMatch && fieldMatch[1] && fieldMatch[2]) {
          fields[fieldMatch[1]] = fieldMatch[2].trim();
        }
      }
      return {
        uri: uri.toString(),
        filename: uri.path.base,
        name: fields["name"] ?? fallback.name,
        description: fields["description"] ?? "",
        type: this.normalizeType(fields["type"]),
      };
    } catch {
      return fallback;
    }
  }

  private normalizeType(value: string | undefined): MemoryType | "unknown" {
    if (!value) return "unknown";
    return (MEMORY_TYPES as readonly string[]).includes(value)
      ? (value as MemoryType)
      : "unknown";
  }

  private workspaceRoot(): URI | undefined {
    return this.workspace.tryGetRoots()[0]?.resource;
  }

  private readonly handleAdd = (): void => {
    void this.commands.executeCommand(SpexrCommands.MEMORY_ADD.id);
  };

  private readonly handleOpen = (uri: string): void => {
    void this.commands.executeCommand(SpexrCommands.MEMORY_OPEN.id, uri);
  };

  private readonly handleDelete = (uri: string): void => {
    void this.commands.executeCommand(SpexrCommands.MEMORY_DELETE.id, uri);
  };

  private readonly handleRefresh = (): void => {
    void this.refreshEntries();
  };

  private readonly handleLink = (): void => {
    void this.runAndRefresh(SpexrCommands.MEMORY_LINK.id);
  };

  private readonly handleUnlink = (): void => {
    void this.runAndRefresh(SpexrCommands.MEMORY_UNLINK.id);
  };

  private readonly handleResolveConflict = (): void => {
    void this.runAndRefresh(SpexrCommands.MEMORY_RESOLVE_CONFLICT.id);
  };

  private async runAndRefresh(commandId: string): Promise<void> {
    await this.commands.executeCommand(commandId);
    await this.refreshEntries();
  }

  protected render(): React.ReactNode {
    return (
      <MemoryPanel
        entries={this.entries}
        hasWorkspace={Boolean(this.workspaceRoot())}
        linkStatus={this.linkStatus}
        onAdd={this.handleAdd}
        onOpen={this.handleOpen}
        onDelete={this.handleDelete}
        onRefresh={this.handleRefresh}
        onLink={this.handleLink}
        onUnlink={this.handleUnlink}
        onResolveConflict={this.handleResolveConflict}
      />
    );
  }
}

const MemoryPanel: React.FC<MemoryPanelProps> = ({
  entries,
  hasWorkspace,
  linkStatus,
  onAdd,
  onOpen,
  onDelete,
  onRefresh,
  onLink,
  onUnlink,
  onResolveConflict,
}) => {
  const isLinked = linkStatus === "linked" || linkStatus === "already-linked";
  const isUnlinked = linkStatus === "not-linked" || linkStatus === "unlinked";
  const isBlocked = linkStatus === "blocked";
  const linkDisabled = !hasWorkspace || isLinked || isBlocked;
  const unlinkDisabled = !hasWorkspace || isUnlinked || isBlocked;
  return (
  <section className="spexr-memory-panel" aria-label="Memory manager">
    <header className="spexr-memory-panel__header">
      <h2>Memory</h2>
      <p className="spexr-memory-panel__hint">
        Persistent notes the agent loads on every session so it remembers what matters without
        you re-explaining it each time.
      </p>
    </header>

    <div className="spexr-memory-panel__actions">
      <button
        type="button"
        className="sl-btn sl-btn--primary"
        onClick={onAdd}
        disabled={!hasWorkspace}
      >
        + New memory
      </button>
      <button
        type="button"
        className="sl-btn sl-btn--ghost"
        onClick={onRefresh}
        disabled={!hasWorkspace}
      >
        Refresh
      </button>
    </div>

    {hasWorkspace && entries.length > 0 ? (
      <ul className="spexr-memory-list" role="list">
        {entries.map((entry) => (
          <li key={entry.uri} className="spexr-memory-list__item">
            <div className="spexr-memory-list__meta">
              <div className="spexr-memory-list__head">
                <span
                  className={`${entry.type === "user" ? "sl-tag" : "sl-tag sl-tag--plain"} spexr-memory-pill`}
                  aria-label={`Type ${entry.type}`}
                >
                  {entry.type}
                </span>
                <span className="spexr-memory-list__name">{entry.name}</span>
              </div>
              {entry.description ? (
                <span className="spexr-memory-list__desc">{entry.description}</span>
              ) : null}
              <span className="spexr-memory-list__filename">{entry.filename}</span>
            </div>
            <div className="spexr-memory-list__buttons">
              <button
                type="button"
                className="sl-btn sl-btn--ghost sl-btn--sm"
                onClick={() => onOpen(entry.uri)}
                aria-label={`Open ${entry.name}`}
              >
                Open
              </button>
              <button
                type="button"
                className="sl-btn sl-btn--ghost sl-btn--sm sl-btn--danger"
                onClick={() => onDelete(entry.uri)}
                aria-label={`Delete ${entry.name}`}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    ) : null}

    {hasWorkspace && entries.length === 0 ? (
      <div className="sl-empty spexr-memory-panel__empty">
        <p className="sl-empty__body">
          No project memories yet. Use <strong>+ New memory</strong> to add one.
        </p>
      </div>
    ) : null}

    {!hasWorkspace ? (
      <div className="sl-empty spexr-memory-panel__empty">
        <p className="sl-empty__body">
          Open a workspace to manage its project memory.
        </p>
      </div>
    ) : null}

    <div className="spexr-memory-panel__section">
      <h3 className="spexr-memory-panel__subtitle">
        Agent connection{" "}
        <span
          className={`${LINK_BADGE[linkStatus].className} spexr-link-badge`}
          aria-label={`Memory link status: ${LINK_BADGE[linkStatus].label}`}
        >
          {LINK_BADGE[linkStatus].label}
        </span>
      </h3>
      {isBlocked ? (
        <>
          <p className="spexr-memory-panel__hint">
            Claude already has its own memory for this project at the native location, so SPEXR
            cannot link automatically. Resolving backs up the existing folder to a timestamped path
            and links <code>docs/memory</code> in its place — nothing is deleted.
          </p>
          <div className="spexr-memory-panel__actions">
            <button
              type="button"
              className="sl-btn sl-btn--ghost sl-btn--danger"
              onClick={onResolveConflict}
            >
              Resolve conflict…
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="spexr-memory-panel__hint">
            Project memory is linked into the Claude session so the agent reads it live. Unlink to
            stop sharing it with this account — your files stay; only the link is removed.
          </p>
          <div className="spexr-memory-panel__actions">
            <button
              type="button"
              className="sl-btn sl-btn--ghost"
              onClick={onLink}
              disabled={linkDisabled}
            >
              Link memory
            </button>
            <button
              type="button"
              className="sl-btn sl-btn--ghost sl-btn--danger"
              onClick={onUnlink}
              disabled={unlinkDisabled}
            >
              Unlink memory
            </button>
          </div>
        </>
      )}
    </div>

    <div className="spexr-memory-panel__section">
      <h3 className="spexr-memory-panel__subtitle">Scopes</h3>
      <ul className="spexr-memory-panel__scopes">
        <li>
          <strong>baseline</strong> — community defaults shipped with SPEXR.
        </li>
        <li>
          <strong>user</strong> — your personal prefs in <code>~/.spexr/memory/</code>, applied
          across every project.
        </li>
        <li>
          <strong>project</strong> — facts about this repo in{" "}
          <code>&lt;workspace&gt;/docs/memory/</code> (managed above).
        </li>
      </ul>
    </div>

    <div className="spexr-memory-panel__section">
      <h3 className="spexr-memory-panel__subtitle">What to save</h3>
      <dl className="spexr-memory-panel__examples">
        <dt>user</dt>
        <dd>
          Who you are and how you work. <em>“Senior backend engineer, prefers terse review
          comments, replies in Italian.”</em>
        </dd>
        <dt>feedback</dt>
        <dd>
          Corrections and validated approaches. <em>“Don't mock the database in integration
          tests — last quarter a mocked test passed while the prod migration failed.”</em>
        </dd>
        <dt>project</dt>
        <dd>
          Ongoing work, deadlines, motivations. <em>“Auth middleware rewrite driven by legal,
          not tech debt — favor compliance over ergonomics.”</em>
        </dd>
        <dt>reference</dt>
        <dd>
          Where to look for things. <em>“Pipeline bugs tracked in Linear project ‘INGEST’.”</em>
        </dd>
      </dl>
    </div>

    <p className="spexr-memory-panel__footnote">
      Entries live as markdown under the matching scope folder. The agent reads them on
      start; promote a note from <strong>project</strong> to <strong>user</strong> when it
      stops being repo-specific.
    </p>
  </section>
  );
};
