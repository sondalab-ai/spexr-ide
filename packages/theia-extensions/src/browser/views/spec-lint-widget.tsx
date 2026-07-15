import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
import { BadgeService } from "@theia/core/lib/browser/badges/badge-service.js";
import { DisposableCollection } from "@theia/core/lib/common/disposable";
import { EditorManager, type EditorWidget } from "@theia/editor/lib/browser";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import type URI from "@theia/core/lib/common/uri";
import {
  lintSpec,
  parseFrontmatter,
  type SpecLintFinding,
  type SpecLintReport,
  type SpecLintSeverity,
} from "@spexr/spec";
import { SPEC_LINT_VIEW_ID } from "./spec-lint-view-contribution.js";
import { specsDir } from "../workspace-paths.js";

const SPEC_SLUG_RE = /^(\d{4}-[a-z0-9][a-z0-9-]*)\.md$/;

/** Debounce window before re-linting on every keystroke (AC-6). */
const LINT_DEBOUNCE_MS = 200;

interface LintState {
  readonly specUri: string;
  readonly title: string;
  readonly report: SpecLintReport;
}

const SEVERITY_META: Record<
  SpecLintSeverity,
  { readonly label: string; readonly icon: string; readonly className: string }
> = {
  error: { label: "Errors", icon: "codicon-error", className: "spexr-spec-lint--error" },
  warn: { label: "Warnings", icon: "codicon-warning", className: "spexr-spec-lint--warn" },
  info: { label: "Info", icon: "codicon-info", className: "spexr-spec-lint--info" },
};

const SEVERITY_ORDER: readonly SpecLintSeverity[] = ["error", "warn", "info"];

/**
 * Bottom-panel companion that validates the spec in the active editor live.
 * Reads the in-memory Monaco buffer (no save required), re-lints on a debounced
 * content change, and renders findings grouped by severity with line anchors
 * that navigate the editor on click.
 */
@injectable()
export class SpexrSpecLintWidget extends ReactWidget {
  static readonly ID = SPEC_LINT_VIEW_ID;

  @inject(EditorManager)
  private readonly editorManager!: EditorManager;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(BadgeService)
  private readonly badgeService!: BadgeService;

  private state: LintState | undefined;
  private knownSlugs: string[] = [];
  /** Editor currently linted, plus its content-change subscription. */
  private tracked: EditorWidget | undefined;
  private readonly trackedDisposables = new DisposableCollection();
  private debounce: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.id = SpexrSpecLintWidget.ID;
    this.title.label = "Spec validation";
    this.title.caption = "Live validation of the open spec";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-checklist";
    this.addClass("spexr-spec-lint-widget");
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(
      this.editorManager.onCurrentEditorChanged(() => this.retarget()),
    );
    this.toDispose.push(this.trackedDisposables);
    this.retarget();
    this.update();
  }

  /**
   * Bind to the active editor when it is a spec, attaching a content-change
   * listener so findings refresh without a save. Non-spec editors clear to the
   * neutral empty state (AC-6).
   */
  private retarget(): void {
    const widget = this.editorManager.currentEditor;
    const uri = widget?.getResourceUri();
    const isSpec = !!uri && SPEC_SLUG_RE.test(uri.path.base);
    if (!widget || !uri || !isSpec) {
      this.trackedDisposables.dispose();
      this.tracked = undefined;
      this.state = undefined;
      this.badgeService.showBadge(this);
      this.update();
      return;
    }
    if (this.tracked === widget) {
      void this.relint();
      return;
    }
    this.trackedDisposables.dispose();
    this.tracked = widget;
    this.trackedDisposables.push(
      widget.editor.onDocumentContentChanged(() => this.scheduleRelint()),
    );
    void this.relint();
  }

  private scheduleRelint(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.relint();
    }, LINT_DEBOUNCE_MS);
  }

  /** Re-read the live buffer and recompute findings for the tracked spec. */
  private async relint(): Promise<void> {
    const widget = this.tracked;
    const uri = widget?.getResourceUri();
    if (!widget || !uri) return;
    if (this.knownSlugs.length === 0) await this.refreshKnownSlugs();
    const raw = widget.editor.document.getText();
    const report = lintSpec(raw, { filename: uri.path.base, knownSlugs: this.knownSlugs });
    this.state = { specUri: uri.toString(), title: specTitle(raw, uri), report };
    const errors = report.findings.filter((f) => f.severity === "error").length;
    const warns = report.findings.filter((f) => f.severity === "warn").length;
    const count = errors + warns;
    if (count > 0) {
      this.badgeService.showBadge(this, {
        value: count,
        tooltip: `${errors} error${errors !== 1 ? "s" : ""}, ${warns} warning${warns !== 1 ? "s" : ""}`,
      });
    } else {
      this.badgeService.showBadge(this);
    }
    this.update();
  }

  private async refreshKnownSlugs(): Promise<void> {
    const root = this.workspace.tryGetRoots()[0]?.resource;
    if (!root) return;
    try {
      const stat = await this.fileService.resolve(specsDir(root));
      this.knownSlugs = (stat.children ?? [])
        .map((c) => c.name.match(SPEC_SLUG_RE)?.[1])
        .filter((s): s is string => !!s);
    } catch {
      this.knownSlugs = [];
    }
  }

  private readonly handleSelect = (finding: SpecLintFinding): void => {
    const widget = this.tracked;
    const uri = widget?.getResourceUri();
    if (!widget || !uri) return;
    if (finding.line === undefined) {
      widget.activate();
      return;
    }
    const pos = { line: finding.line - 1, character: 0 };
    void this.editorManager.open(uri, {
      mode: "activate",
      selection: { start: pos, end: pos },
    });
  };

  protected override onActivateRequest(msg: Message): void {
    super.onActivateRequest(msg);
    this.node.focus();
  }

  protected render(): React.ReactNode {
    return <SpecLintPanel state={this.state} onSelect={this.handleSelect} />;
  }
}

/** Read the spec title from frontmatter, falling back to the filename. */
function specTitle(raw: string, uri: URI): string {
  const title = parseFrontmatter(raw).data.title;
  return typeof title === "string" && title.trim().length > 0 ? title.trim() : uri.path.base;
}

interface SpecLintPanelProps {
  readonly state: LintState | undefined;
  readonly onSelect: (finding: SpecLintFinding) => void;
}

const SpecLintPanel: React.FC<SpecLintPanelProps> = ({ state, onSelect }) => {
  if (!state) {
    return (
      <section className="spexr-spec-lint" aria-label="Spec validation">
        <p className="spexr-spec-lint__empty">Open a spec to validate it.</p>
      </section>
    );
  }
  const { report } = state;
  const total = report.errorCount + report.warnCount + report.infoCount;
  return (
    <section className="spexr-spec-lint" aria-label="Spec validation">
      <header className="spexr-spec-lint__header">
        {total === 0 ? (
          <span className="spexr-spec-lint__ok">
            <span className="codicon codicon-check" aria-hidden /> No issues found
          </span>
        ) : (
          <span className="spexr-spec-lint__summary">{summaryText(report)}</span>
        )}
      </header>
      {SEVERITY_ORDER.map((severity) => {
        const group = report.findings.filter((f) => f.severity === severity);
        if (group.length === 0) return null;
        return (
          <div key={severity} className={`spexr-spec-lint__group ${SEVERITY_META[severity].className}`}>
            <h3 className="spexr-spec-lint__group-title">{SEVERITY_META[severity].label}</h3>
            <ul className="spexr-spec-lint__list" role="list">
              {group.map((f, i) => (
                <li key={`${severity}:${f.line ?? "x"}:${i}`}>
                  <button
                    type="button"
                    className="spexr-spec-lint__finding"
                    onClick={() => onSelect(f)}
                    aria-label={`${f.section}: ${f.message}`}
                  >
                    <span className={`spexr-spec-lint__icon codicon ${SEVERITY_META[severity].icon}`} />
                    <span className="spexr-spec-lint__body">
                      <span className="spexr-spec-lint__message">
                        <span className="spexr-spec-lint__section">{f.section}</span>
                        {f.message}
                      </span>
                      {f.suggestion ? (
                        <span className="spexr-spec-lint__suggestion">{f.suggestion}</span>
                      ) : null}
                    </span>
                    {f.line !== undefined ? (
                      <span className="spexr-spec-lint__line">{`L${f.line}`}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
};

function summaryText(report: SpecLintReport): string {
  const parts: string[] = [];
  if (report.errorCount > 0) parts.push(`${report.errorCount} ${plural(report.errorCount, "error")}`);
  if (report.warnCount > 0) parts.push(`${report.warnCount} ${plural(report.warnCount, "warning")}`);
  if (report.infoCount > 0) parts.push(`${report.infoCount} info`);
  return parts.join(", ");
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
