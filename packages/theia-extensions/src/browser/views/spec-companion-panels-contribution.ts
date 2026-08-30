import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import {
  type FrontendApplicationContribution,
  ApplicationShell,
  type Widget,
} from "@theia/core/lib/browser";
import { EditorWidget } from "@theia/editor/lib/browser";
import { SpexrSpecResourcesViewContribution } from "./spec-resources-view-contribution.js";
import { SpexrSpecLintViewContribution } from "./spec-lint-view-contribution.js";
import {
  SpexrSpecCompanionPanelsPolicy,
  type SpecCompanionPanel,
} from "./spec-companion-panels-policy.js";

const SPEC_FILE_RE = /^\d{4}-[a-z0-9][a-z0-9-]*\.md$/;

/** The slice of `AbstractViewContribution` a companion panel is driven through. */
interface CompanionView {
  tryGetWidget(): Widget | undefined;
  openView(options?: { activate?: boolean; reveal?: boolean }): Promise<Widget>;
}

/**
 * Shows the spec companion panels (spec validation, linked resources) whenever a
 * spec editor is in front, and hides them everywhere else. All the decision
 * logic lives in {@link SpexrSpecCompanionPanelsPolicy}; this contribution only
 * resolves the spec in front and adapts the two views to the policy's port.
 */
@injectable()
export class SpexrSpecCompanionPanelsContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  @inject(SpexrSpecLintViewContribution)
  private readonly lintView!: SpexrSpecLintViewContribution;

  @inject(SpexrSpecResourcesViewContribution)
  private readonly resourcesView!: SpexrSpecResourcesViewContribution;

  private policy!: SpexrSpecCompanionPanelsPolicy;

  /** Linked resources is revealed last so it is the tab left in front. */
  @postConstruct()
  protected init(): void {
    this.policy = new SpexrSpecCompanionPanelsPolicy([
      this.asPanel(this.lintView),
      this.asPanel(this.resourcesView),
    ]);
  }

  /**
   * Listens on the main dock panel rather than `shell.onDidChangeCurrentWidget`:
   * the latter is driven by a Lumino `FocusTracker`, so focusing a terminal or
   * the Problems view fires it even though the main area did not change.
   * `TheiaDockPanel.onDidChangeCurrent` fires on main tab selection only.
   *
   * `onDidAddWidget` covers the open path: a widget is added before the dock
   * panel marks its tab current, and the policy no-ops when the spec in front
   * has not changed, so the extra notification costs nothing.
   */
  onStart(): void {
    this.shell.mainPanel.onDidChangeCurrent(() => void this.sync());
    this.shell.onDidAddWidget(() => void this.sync());
    void this.sync();
  }

  private sync(): Promise<void> {
    return this.policy.sync(this.currentSpecKey());
  }

  /**
   * URI of the spec editor in front of the main area, or `undefined` for any
   * other tab. Reads `mainPanel.currentTitle`, so window focus never affects it.
   */
  private currentSpecKey(): string | undefined {
    const widget = this.shell.getCurrentWidget("main");
    if (!(widget instanceof EditorWidget)) return undefined;
    const uri = widget.getResourceUri();
    if (!uri || !SPEC_FILE_RE.test(uri.path.base)) return undefined;
    return uri.toString();
  }

  private asPanel(view: CompanionView): SpecCompanionPanel {
    return {
      reveal: async () => {
        await view.openView({ reveal: true, activate: false });
      },
      close: () => view.tryGetWidget()?.close(),
    };
  }
}
