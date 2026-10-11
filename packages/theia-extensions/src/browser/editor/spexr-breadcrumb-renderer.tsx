import * as React from "@theia/core/shared/react";
import { injectable } from "@theia/core/shared/inversify";
import { DefaultBreadcrumbRenderer } from "@theia/core/lib/browser/breadcrumbs/breadcrumb-renderer";
import { Styles, type Breadcrumb } from "@theia/core/lib/browser/breadcrumbs/breadcrumbs-constants";
import { crumbText } from "./breadcrumb-model.js";

/**
 * One breadcrumb as Lumen draws it (S6c, E6): the name alone, with no icon,
 * a function or method followed by `()`. The outline's trailing "…" is
 * dropped by the row (`SpexrBreadcrumbsRenderer`). Theia's popup on click is kept.
 */
@injectable()
export class SpexrBreadcrumbRenderer extends DefaultBreadcrumbRenderer {
  override render(breadcrumb: Breadcrumb, onMouseDown?: (breadcrumb: Breadcrumb, event: React.MouseEvent) => void): React.ReactNode {
    return (
      <li
        key={breadcrumb.id}
        title={breadcrumb.longLabel}
        className={Styles.BREADCRUMB_ITEM + (onMouseDown ? ` ${Styles.BREADCRUMB_ITEM_HAS_POPUP}` : "")}
        onMouseDown={(event) => onMouseDown?.(breadcrumb, event)}
        tabIndex={0}
        data-breadcrumb-id={breadcrumb.id}
      >
        <span>{crumbText(breadcrumb.label, breadcrumb.iconClass)}</span>
      </li>
    );
  }
}
