---
name: sondalab-effects-dress-only-added-nodes
description: The kit's effects.js mount() dresses glass/aurora hosts only when they are added to the DOM; React re-renders can strip the layers.
metadata:
  type: reference
---

`mount(document)` from `@sondalab/ui-kit/effects.js` is called once in SPEXR (`theme/spexr-effects-contribution.ts`). Its MutationObserver dresses `.sl-fx-glass`/`.sl-fx-aurora` hosts only when an element node is **added**. It adds the `sl-glass`/`is-lensed` classes and prepends the `.sl-glass__*` layer children.

In React:
- Keep `className` static on glass hosts. A changed className rewrites the attribute and drops `sl-glass`.
- Wrap a changing text label in a `<span>`. A bare single-text child is reset via `textContent`, which deletes the injected layers.
- A class toggled onto an existing element gets only the CSS Tier 0 look (no glow). Remounting it via `key` fixes that but loses keyboard focus, so SPEXR accepts Tier 0 there (the layout segmented control).

The GPU tier (`mountGpu`, needs `vgpu` in the kit's `^0.3.1` peer range) follows `spexr.effects.gpu.enabled` (on by default; written to `false` in user settings when `navigator.gpu` has no adapter). The kit cannot tear it down, so turning it off asks for a window reload. `data-sl-fx-gpu="on"` appears only after the first painted frame, which needs the pointer on a glass pane.

The lens bends only what is behind a pane: over a flat panel it is invisible, hence the `--spexr-glass-ground` gradients on panels that host glass controls.

Related: [[spexr-can-adopt-sondalab-ui-kit-sl-component-classes-without]]
