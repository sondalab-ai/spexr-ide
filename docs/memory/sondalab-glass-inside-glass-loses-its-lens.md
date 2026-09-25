---
name: sondalab-glass-inside-glass-loses-its-lens
description: A kit glass host nested inside another loses its lens; only leaf cards can take sl-fx-glass--pane, and our card background rules must be cleared for it to show.
metadata:
  type: reference
---

A lensed `.sl-fx-glass` pane carries its own `backdrop-filter`, which makes it a backdrop root. So `glass-lens.js` refuses the lens to any glass host inside another one (`el.parentElement?.closest(".sl-glass, .sl-fx-glass")`), and that inner host keeps only a flat material. In SPEXR, only cards with no glass buttons inside take glass: the Darkfactory session card, welcome cards, the plan checklist and the stepper tooltip. Spec list items, pinned cards, the launcher, the browser pane and the TODO file card all hold glass buttons, so they do not take glass (spec items use a translucent fill instead).

Two CSS traps when adding glass to a spexr card:
- The kit clears `background-color` on a glass host once its layers are built (`.sl-glass`, kit 0.15.1), but our own `.spexr-*` `background:` rules come later and win. Clear them on the same condition (`.sl-glass`, outside high contrast, where no layers are built), and rebind `--slfx-fill`/`--slg-tint-color` for hover instead of painting a background.
- A card's own `transition:` shorthand replaces the kit's transform transition, so the hover swell snaps. Restate `transform 420ms cubic-bezier(0.22, 0.61, 0.28, 1)`.

The aurora (including the `--pillars` light columns) shows only on focus, `data-sl-fx-live="on"`, `busy` or `run`, never on hover. `run` (a working agent) and `busy` are drawn in WebGL by `live-light.js` from `--slc-accent` and `--slfx-depth` on the host.

Related: [[sondalab-effects-dress-only-added-nodes]]
