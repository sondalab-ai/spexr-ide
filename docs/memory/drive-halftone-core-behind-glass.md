---
name: drive-halftone-core-behind-glass
description: Behind SPEXR's glass panes, draw halftones with the kit's halftone-core on a throttled clock; never mount the kit's live halftone() (data-sl-halftone), which repaints every frame while in view.
metadata:
  type: feedback
---

The kit's live `halftone()` (armed by `mount()` for any `canvas[data-sl-halftone]`) runs a frame loop at the display rate while a scene is near the viewport. Behind SPEXR's lensed glass every frame re-composites the window: the cost https://github.com/sondalab-ai/spexr-ide/pull/67 removed.

**Why:** the photo backdrop (`backdrop/photo-background.tsx`) would otherwise undo the idle-repaint work.

**How to apply:** import `sampleDots`/`dotFrame`/`settledFrame`/`cover` from `@spexr/ui-kit/halftone`; gather at rAF once (≈1.9 s), then tick at 120 ms like the Life backdrop; stop on `data-spexr-motion="paused"`, power save, hidden. Print the picture's light in either theme: the kit's dark-ink inversion turns a space photo's sky into a solid blot.
