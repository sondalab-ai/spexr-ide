---
name: theia-colors-css-vs-registry
description: SPEXR overrides Theia colors in CSS only, so anything Theia reads from the color registry in JS never sees the palette
metadata:
  type: reference
---

SPEXR paints Theia's native chrome by writing `--theia-*` variables in an `!important` block (`SpexrThemeContribution.applyAccentOverrides`). That covers everything Theia styles through CSS — and nothing it reads from the **color registry in JavaScript**. Those two paths look identical from the outside and diverge silently: no error, just a color that belongs to no theme in the product.

**xterm's background — a real bug this caused.** The terminal draws onto a canvas, taking `terminal.background` from the registry, so `--theia-terminal-background` never reaches it. Worse, the value was registered as `Color.darken("editor.background", 0.35)`, and `editor.background` *in the registry* is Theia's built-in gray, not the SPEXR canvas, which is only overridden in CSS. The terminal was therefore a black derived from a color the product never uses. Fixed by registering the SPEXR canvas directly in `SpexrColorContribution`.

**`theme.background` — same shape, and worth keeping consistent.** `ThemePreloadContribution` copies the localStorage key `theme.background` into `--theia-editor-background` during preload, and Theia fills that key from `colors.getCurrentColor('editor.background')` — a registry read, so again not our palette. `apps/desktop/preload.html` seeds it and `applyTheme` re-asserts it, since Theia rewrites it on every color-theme change.

Do not, however, expect that to fix a startup colour flash: it was chased for exactly that and did nothing. What is painted before the document exists is the Electron window's own background — see [[electron-window-background-flash]].

**Rule of thumb:** before overriding a Theia color, ask where it actually lands — a DOM node, a canvas, a persisted key, or the native window. CSS is enough only for the first. Registering in the color registry is not always available either: colors baked into the built-in theme JSON win over registry defaults, which is why `activityBarBadge.background` and `menu.selectionBackground` live in the CSS layer instead. See [[theme-architecture]].
