import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser";
import { CommandService } from "@theia/core/lib/common/command";
import { MessageService } from "@theia/core/lib/common/message-service";
import { nls } from "@theia/core/lib/common/nls";
import type URI from "@theia/core/lib/common/uri";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { EditorManager } from "@theia/editor/lib/browser";
import { TODO_VIEW_ID } from "./todo-view-contribution.js";
import { parseTodo, toggleTodo, type TodoItem } from "./todo-list.js";
import type { TodoHandoff } from "./todo-handoff.js";

/** The file the view reads, at the root of each workspace folder. */
const TODO_FILE = "TODO.md";

/** One workspace folder's TODO.md, as last read. */
interface TodoFile {
  readonly root: URI;
  readonly uri: URI;
  /** Undefined when the folder has no TODO.md. */
  readonly items: readonly TodoItem[] | undefined;
}

/**
 * The checklists in each workspace folder's TODO.md: open items first, done
 * ones folded away. An item can be ticked (only its own line is rewritten),
 * opened at its line, or handed to the agent with "Work on this". The view
 * follows the file, so the agent ticking an item shows up here too.
 */
@injectable()
export class SpexrTodoWidget extends ReactWidget {
  static readonly ID = TODO_VIEW_ID;

  @inject(WorkspaceService) private readonly workspace!: WorkspaceService;
  @inject(FileService) private readonly fileService!: FileService;
  @inject(EditorManager) private readonly editors!: EditorManager;
  @inject(CommandService) private readonly commands!: CommandService;
  @inject(MessageService) private readonly messages!: MessageService;

  private files: readonly TodoFile[] = [];
  /** Item keys whose details are unfolded. */
  private readonly expanded = new Set<string>();
  /** Item keys being handed to the agent (the local model may take a while). */
  private readonly sending = new Set<string>();
  private showDone = false;

  constructor() {
    super();
    this.id = SpexrTodoWidget.ID;
    this.title.label = nls.localize("spexr/todo/title", "TODO");
    this.title.caption = "The checklist in TODO.md";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-checklist";
    this.addClass("spexr-todo-widget");
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(this.workspace.onWorkspaceChanged(() => void this.refresh()));
    this.toDispose.push(
      this.fileService.onDidFilesChange((event) => {
        const watched = this.workspace.tryGetRoots().map((r) => r.resource.resolve(TODO_FILE));
        if (watched.some((uri) => event.contains(uri))) void this.refresh();
      }),
    );
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const roots = this.workspace.tryGetRoots().map((r) => r.resource);
    this.files = await Promise.all(
      roots.map(async (root) => {
        const uri = root.resolve(TODO_FILE);
        try {
          const content = await this.fileService.read(uri);
          return { root, uri, items: parseTodo(content.value) };
        } catch {
          return { root, uri, items: undefined };
        }
      }),
    );
    this.update();
  }

  private key(file: TodoFile, item: TodoItem): string {
    return `${file.uri.toString()}#${item.line}`;
  }

  private async toggle(file: TodoFile, item: TodoItem): Promise<void> {
    try {
      const current = await this.fileService.read(file.uri);
      const next = toggleTodo(current.value, item);
      if (next === undefined) {
        this.messages.warn(`${TODO_FILE} changed since it was shown here; the list is reloaded.`);
      } else {
        await this.fileService.write(file.uri, next);
      }
    } catch (err) {
      this.messages.error(`Could not update ${TODO_FILE}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await this.refresh();
  }

  private open(file: TodoFile, item: TodoItem): void {
    const position = { line: item.line, character: 0 };
    void this.editors.open(file.uri, { selection: { start: position, end: position } });
  }

  private async workOn(file: TodoFile, item: TodoItem): Promise<void> {
    const key = this.key(file, item);
    if (this.sending.has(key)) return;
    this.sending.add(key);
    this.update();
    const handoff: TodoHandoff = {
      path: file.root.relative(file.uri)?.toString() ?? TODO_FILE,
      line: item.line,
      title: item.title,
      details: item.details,
    };
    try {
      await this.commands.executeCommand("spexr.todo.workOn", file.root.toString(), handoff);
    } finally {
      this.sending.delete(key);
      this.update();
    }
  }

  private toggleDetails(key: string): void {
    if (this.expanded.has(key)) this.expanded.delete(key);
    else this.expanded.add(key);
    this.update();
  }

  protected render(): React.ReactNode {
    if (this.files.length === 0) {
      return <p className="spexr-todo__empty">Open a workspace to see its TODO.md.</p>;
    }
    const multiRoot = this.files.length > 1;
    const done = this.files.reduce((n, f) => n + (f.items?.filter((i) => i.done).length ?? 0), 0);
    return (
      <section className="spexr-todo" aria-label="TODO">
        {this.files.map((file) => (
          <div key={file.uri.toString()} className="spexr-todo__file">
            {multiRoot && <h3 className="spexr-todo__folder">{file.root.path.base}</h3>}
            {file.items === undefined ? (
              <p className="spexr-todo__empty">No {TODO_FILE} in this folder.</p>
            ) : file.items.every((i) => i.done) ? (
              <p className="spexr-todo__empty">Nothing left to do.</p>
            ) : (
              <ul className="spexr-todo__list" role="list">
                {file.items.filter((i) => !i.done).map((item) => this.renderItem(file, item))}
              </ul>
            )}
          </div>
        ))}
        {done > 0 && (
          <div className="spexr-todo__done">
            <button
              className="spexr-todo__done-toggle"
              aria-expanded={this.showDone}
              onClick={() => {
                this.showDone = !this.showDone;
                this.update();
              }}
            >
              <i className={`codicon codicon-chevron-${this.showDone ? "down" : "right"}`} />
              Done ({done})
            </button>
            {this.showDone &&
              this.files.map((file) => (
                <ul key={file.uri.toString()} className="spexr-todo__list" role="list">
                  {file.items?.filter((i) => i.done).map((item) => this.renderItem(file, item))}
                </ul>
              ))}
          </div>
        )}
      </section>
    );
  }

  private renderItem(file: TodoFile, item: TodoItem): React.ReactElement {
    const key = this.key(file, item);
    const open = this.expanded.has(key);
    const sending = this.sending.has(key);
    return (
      <li key={key} className={`spexr-todo__item${item.done ? " spexr-todo__item--done" : ""}`}>
        <label className="sl-check spexr-todo__check">
          <input
            type="checkbox"
            className="sl-check__input"
            checked={item.done}
            aria-label={item.done ? "Mark as not done" : "Mark as done"}
            onChange={() => void this.toggle(file, item)}
          />
          <span className="sl-check__box" aria-hidden="true" />
        </label>
        <div className="spexr-todo__body">
          <button className="spexr-todo__title" title="Open TODO.md at this item" onClick={() => this.open(file, item)}>
            {item.title}
          </button>
          {item.details && (
            <button className="spexr-todo__more" aria-expanded={open} onClick={() => this.toggleDetails(key)}>
              <i className={`codicon codicon-chevron-${open ? "down" : "right"}`} />
              {open ? "Less" : "Details"}
            </button>
          )}
          {open && <pre className="spexr-todo__details">{item.details}</pre>}
        </div>
        {!item.done && (
          <button
            className="sl-btn sl-btn--ghost sl-btn--sm spexr-todo__work sl-fx-glass sl-fx-glass--pane sl-fx-press"
            disabled={sending}
            title="Hand this item to the agent; the local model picks the expert best suited to it"
            onClick={() => void this.workOn(file, item)}
          >
            <i className={`codicon ${sending ? "codicon-loading codicon-modifier-spin" : "codicon-sparkle"}`} />
            {sending ? "Sending…" : "Work on this"}
          </button>
        )}
      </li>
    );
  }
}
