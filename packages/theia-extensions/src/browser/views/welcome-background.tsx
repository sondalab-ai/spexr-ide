import * as React from "react";
import { POWER_SAVE_ATTRIBUTE, isPowerSaving } from "../power/power-save-dom.js";
import { followStep } from "./welcome-follow.js";

/** Decorative blobs; `depth` pairs with the per-class parallax factor in CSS. */
const BLOBS = ["a", "b", "c", "d", "e"] as const;

/** How strongly the pointer pulls the current position each frame (lower = slower). */
const FOLLOW = 0.02;

/**
 * Iridescent, heavily blurred "glass" backdrop for the welcome page.
 *
 * Renders a fixed set of gradient blobs whose hue drifts on their own CSS
 * animation, while a requestAnimationFrame loop eases two CSS custom properties
 * (`--wx`, `--wy`, normalized to roughly -1..1) toward the pointer position so
 * the blobs trail the mouse very slowly via per-blob parallax. The loop runs
 * only while the blobs are still catching up with the pointer. Honors
 * `prefers-reduced-motion` by leaving the layer static, and stops the loop
 * while SPEXR saves power (the CSS stills the drift then too).
 */
export const WelcomeBackground: React.FC = () => {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let cur = { x: 0, y: 0 };
    const tgt = { x: 0, y: 0 };

    const tick = (): void => {
      const next = followStep(cur, tgt, FOLLOW);
      cur = next;
      el.style.setProperty("--wx", cur.x.toFixed(4));
      el.style.setProperty("--wy", cur.y.toFixed(4));
      raf = next.settled ? 0 : requestAnimationFrame(tick);
    };

    const start = (): void => {
      if (raf === 0 && !isPowerSaving()) raf = requestAnimationFrame(tick);
    };

    // A hidden page has an empty box, so pointer moves elsewhere in the app
    // leave the loop stopped.
    const onMove = (e: MouseEvent): void => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      tgt.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      tgt.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      start();
    };

    const sync = (): void => {
      if (isPowerSaving()) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else {
        start();
      }
    };
    const power = new MutationObserver(sync);
    power.observe(document.documentElement, { attributes: true, attributeFilter: [POWER_SAVE_ATTRIBUTE] });

    window.addEventListener("mousemove", onMove);
    sync();
    return () => {
      window.removeEventListener("mousemove", onMove);
      power.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className="spexr-welcome-bg" aria-hidden>
      {BLOBS.map((id) => (
        <span key={id} className={`spexr-welcome-bg__blob spexr-welcome-bg__blob--${id}`} />
      ))}
    </div>
  );
};
