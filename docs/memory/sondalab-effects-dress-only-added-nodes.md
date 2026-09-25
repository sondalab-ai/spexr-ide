---
name: sondalab-effects-dress-only-added-nodes
description: The kit's effects.js mount() dresses glass/aurora hosts only when they are added to the DOM; React re-renders can strip the layers.
metadata:
  type: reference
---

`mount(document)` from `@spexr/ui-kit/effects` (the kit's `effects.js`) is called from `theme/spexr-theme-contribution.ts` on every theme change; it arms once, and refuses under high contrast until the theme leaves it. Its MutationObserver dresses `.sl-fx-glass`/`.sl-fx-aurora` hosts only when an element node is **added**. It adds the `sl-glass`/`is-lensed` classes and prepends the `.sl-glass__*` layer children.

In React:
- Keep `className` static on glass hosts. A changed className rewrites the attribute and drops `sl-glass`.
- Wrap a changing text label in a `<span>`. A bare single-text child is reset via `textContent`, which deletes the injected layers.
- A class toggled onto an existing element gets only the CSS Tier 0 look (no glow). Remounting it via `key` fixes that but loses keyboard focus, so SPEXR accepts Tier 0 there (the layout segmented control).

There is no GPU tier: the kit retired `mountGpu()` in 0.12 (it always resolves `false`). The glass edge light is CSS driven by `effects.js`, the lens an SVG backdrop filter, and the run/busy light WebGL (`live-light.js`).

The lens bends only what is behind a pane: over a flat panel it is invisible, hence the `--spexr-glass-ground` gradients on panels that host glass controls.

Related: [[spexr-can-adopt-sondalab-ui-kit-sl-component-classes-without]]
