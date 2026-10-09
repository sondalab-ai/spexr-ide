import * as React from "react";

/**
 * The head of a right-island view, as the Lumen agent pane's: a micro-label
 * above a 16px/600 title, over a hairline. The view's own heading replaces
 * Theia's title row (panel-title-contribution.ts hides that row).
 */
export const PanelHead: React.FC<{ readonly eyebrow: string; readonly title: string }> = ({ eyebrow, title }) => (
  <header className="spexr-panel-head">
    <p className="sl-eyebrow spexr-panel-head__eyebrow">{eyebrow}</p>
    <h2 className="spexr-panel-head__title">{title}</h2>
  </header>
);
