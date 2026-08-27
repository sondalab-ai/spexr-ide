---
name: Theme architecture
description: theming via CSS vars + data-sl-theme on root; custom tokens need --sl- prefix.
type: project
---

Theming is driven entirely by CSS custom properties. `applyTheme(themeId)` sets
`data-sl-theme` on the document root; the CSS cascade in `@spexr/ui-kit/themes/*.css`
does the rest, so components never read the active theme directly.

Built-in themes: `light`, `dark`, `high-contrast` (see `BUILT_IN_THEMES`).
Custom themes load token maps via `applyCustomThemeTokens`; every token name must
start with `--sl-` or it throws.

When adding a theme or token, edit the CSS layer + registry — do not branch on theme
inside components.
