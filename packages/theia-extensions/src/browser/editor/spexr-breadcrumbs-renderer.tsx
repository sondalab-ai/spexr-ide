import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { BreadcrumbsRenderer } from "@theia/core/lib/browser/breadcrumbs/breadcrumbs-renderer";
import { SpexrBreadcrumbMetaService } from "./breadcrumb-meta-service.js";
import { visibleCrumbs } from "./breadcrumb-model.js";

/**
 * Theia's breadcrumb row plus Lumen's right-hand meta (S6c, E7): the file's
 * "+a −d · not saved". The crumb list stays the host's first element, since
 * Theia scrolls and measures that one; the meta follows it as a sibling, and
 * the style sheet floats it to the row's end.
 */
@injectable()
export class SpexrBreadcrumbsRenderer extends BreadcrumbsRenderer {
  @inject(SpexrBreadcrumbMetaService)
  private readonly meta!: SpexrBreadcrumbMetaService;

  @postConstruct()
  protected override init(): void {
    super.init();
    this.toDispose.push(
      this.meta.onDidChange((changed) => {
        if (this.uri?.toString() === changed) this.render();
      }),
    );
  }

  /** The row without the outline's trailing "…" (a lone one stays). */
  protected override renderBreadcrumbs(): React.ReactNode {
    return visibleCrumbs(this.breadcrumbs).map((breadcrumb) => this.breadcrumbRenderer.render(breadcrumb, this.togglePopup));
  }

  protected override doRender(): React.ReactNode {
    const text = this.uri ? this.meta.metaFor(this.uri.toString()) : "";
    return (
      <>
        {super.doRender()}
        {text && this.active && (
          <span className="spexr-breadcrumbs-meta" data-parity="crumbs.meta" title="Changed since the last commit">
            {text}
          </span>
        )}
      </>
    );
  }
}
