import * as React from "react";

/**
 * The head of a right-island view, as the Lumen agent pane's: a micro-label
 * above a 16px/600 title, over a hairline, with an optional `aside` (the agent
 * pane's model tag) at the end of the row. The view's own heading replaces
 * Theia's title row (panel-title-contribution.ts hides that row).
 */
export const PanelHead: React.FC<{ readonly eyebrow: string; readonly title: string; readonly aside?: React.ReactNode }> = ({ eyebrow, title, aside }) =>
  aside ? (
    <header className="spexr-panel-head spexr-panel-head--aside">
      <div className="spexr-panel-head__text">
        <p className="sl-eyebrow spexr-panel-head__eyebrow">{eyebrow}</p>
        <h2 className="spexr-panel-head__title">{title}</h2>
      </div>
      {aside}
    </header>
  ) : (
    <header className="spexr-panel-head">
      <p className="sl-eyebrow spexr-panel-head__eyebrow">{eyebrow}</p>
      <h2 className="spexr-panel-head__title">{title}</h2>
    </header>
  );
