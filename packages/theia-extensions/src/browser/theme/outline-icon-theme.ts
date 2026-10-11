import { injectable } from "@theia/core/shared/inversify";
import { Disposable, DisposableCollection, Emitter, type MaybePromise } from "@theia/core";
import URI from "@theia/core/lib/common/uri";
import type { DidChangeLabelEvent, LabelProviderContribution } from "@theia/core/lib/browser/label-provider";
import { URIIconReference } from "@theia/core/lib/browser/label-provider";
import type { IconTheme, IconThemeService } from "@theia/core/lib/browser/icon-theme-service";
import type { IconThemeContribution } from "@theia/core/lib/browser/icon-theme-contribution";
import { FileStat } from "@theia/filesystem/lib/common/files";
import { OUTLINE_ICON_THEME_ID, outlineIconClass, outlineKindOf, type IconElement } from "./outline-icons.js";

/**
 * "spexr outline", the file icon theme Lumen draws (S6f, D10), and the default
 * (`workbench.iconTheme` in the desktop defaults): a file and a folder as
 * monochrome outline codicons, muted, the accent on the current tab and the
 * selected row (spexr.css). The old themes stay selectable.
 *
 * It is the theme and its label provider in one, as Theia's own "none" theme:
 * while active it answers for every file, folder and file stat, and while it is
 * not it answers for nothing.
 */
@injectable()
export class SpexrOutlineIconTheme implements IconTheme, LabelProviderContribution, IconThemeContribution {
  readonly id = OUTLINE_ICON_THEME_ID;
  readonly label = "spexr outline";
  readonly description = "Monochrome outline file and folder icons";
  readonly hasFileIcons = true;
  readonly hasFolderIcons = true;

  private readonly onDidChangeEmitter = new Emitter<DidChangeLabelEvent>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private readonly toDeactivate = new DisposableCollection();

  registerIconThemes(iconThemes: IconThemeService): MaybePromise<void> {
    iconThemes.register(this);
  }

  activate(): Disposable {
    if (this.toDeactivate.disposed) {
      this.toDeactivate.push(Disposable.create(() => this.fireDidChange()));
      this.fireDidChange();
    }
    return this.toDeactivate;
  }

  private fireDidChange(): void {
    this.onDidChangeEmitter.fire({ affects: () => true });
  }

  /** Above the label provider's defaults, as Theia's "none" theme; nothing while another theme is active. */
  canHandle(element: object): number {
    if (this.toDeactivate.disposed) return 0;
    const handled = element instanceof URI || URIIconReference.is(element) || FileStat.is(element);
    return handled ? Number.MAX_SAFE_INTEGER - 1024 : 0;
  }

  getIcon(element: object): string {
    return outlineIconClass(outlineKindOf(element as IconElement));
  }
}
