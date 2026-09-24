import * as React from "react";
import { SPEXR_TIPS, type SpexrTip } from "../data/tips.js";

export interface TipProps {
  readonly tip?: SpexrTip;
  readonly onShuffle?: () => void;
  readonly className?: string;
}

export function pickRandomTip(seed?: number): SpexrTip {
  const index =
    typeof seed === "number"
      ? Math.abs(seed) % SPEXR_TIPS.length
      : Math.floor(Math.random() * SPEXR_TIPS.length);
  return SPEXR_TIPS[index]!;
}

export const Tip: React.FC<TipProps> = ({ tip, onShuffle, className }) => {
  const [current, setCurrent] = React.useState<SpexrTip>(() => tip ?? pickRandomTip());

  React.useEffect(() => {
    if (tip) setCurrent(tip);
  }, [tip]);

  const handleShuffle = React.useCallback(() => {
    setCurrent((prev) => {
      let next = pickRandomTip();
      if (SPEXR_TIPS.length > 1) {
        while (next.id === prev.id) next = pickRandomTip();
      }
      return next;
    });
    onShuffle?.();
  }, [onShuffle]);

  return (
    <aside
      className={`spexr-tip ${className ?? ""}`.trim()}
      role="region"
      aria-label="Tip"
      aria-live="polite"
    >
      <div className="spexr-tip__head">
        <span className="spexr-tip__label">
          <span className="spexr-tip__label-icon" aria-hidden>
            💡
          </span>
          Tip
          <span className="sl-eyebrow sl-eyebrow--accent">{current.category}</span>
        </span>
        <button
          type="button"
          className="spexr-tip__shuffle"
          onClick={handleShuffle}
          aria-label="Show another tip"
        >
          ↻
        </button>
      </div>
      <h3 className="spexr-tip__title">{current.title}</h3>
      <p className="spexr-tip__body">{current.body}</p>
    </aside>
  );
};
