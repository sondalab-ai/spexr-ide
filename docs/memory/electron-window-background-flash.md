---
name: electron-window-background-flash
description: A colour flash before the first paint is the Electron window's own background, persisted in windowstate and outranking the configured windowOptions
metadata:
  type: reference
---

A flat colour filling the whole window for a few hundred milliseconds at startup, with the native title bar already drawn and no content in it, is **not** the page. It is the Electron window's own `backgroundColor`, painted from the moment the window is shown until the document's first paint.

Three facts make it hard to find, and each one defeats an obvious fix:

- **The saved state wins.** `getLastWindowOptions()` builds the options as `{ ...getDefaultOptions(), ...windowState }`, so `windowstate.backgroundColor` in `<userData>/config.json` overrides the `backgroundColor` set in `theia.frontend.config.electron.windowOptions`. Configuring it is inert while a saved state exists.
- **It re-saves itself.** `saveWindowState()` persists `customBackgroundColor ?? window.getBackgroundColor()`, and Theia sets `customBackgroundColor` only from a theme *change* (`ElectronMenuContribution.handleThemeChange`). An application that starts on the right theme and never switches never reports one, so a value captured during some past run of the other theme is re-saved on every exit and never heals.
- **Nothing in the renderer can reach it.** It is painted before the document exists, so guards in `index.html`, `--theia-editor-background`, `theme.background` and the token layer are all downstream of it.

**Fix in the repo:** `SpexrThemeContribution.reportWindowBackground()` calls `electronTheiaCore.setBackgroundColor(canvas)` on every `applyTheme`, so the value Theia persists is the active theme's canvas rather than a stale capture. A stale value already on disk has to be corrected once by hand (or by one theme switch).

## Debugging startup, without guessing

Two tools made the difference after several wrong diagnoses:

**Measure the pixel, do not describe it.** A screen recording plus an AVFoundation frame extractor (`swift`, no ffmpeg needed) locates the flash by mean luminance and then reads the exact RGB of a frame. `#ECE4D4` identified the colour as a specific stored value, not "white" or "light" — which is what finally made it searchable.

**Know which profile the app is using.** The unpackaged dev build is not `~/Library/Application Support/@spexr/desktop`: an Electron app run from source falls back to the name *Electron*, so its localStorage, `config.json` and window state live in `~/Library/Application Support/Electron`. The packaged `/Applications/SPEXR.app` uses the `@spexr` path. Reading the wrong one produced months-old values and sent two fixes down the wrong path. Check the directory mtime before trusting anything in it.

**Instrument rather than reason.** A temporary trace written into `localStorage` from `preload.html` — resolved theme, every `applyTheme`, every Theia theme change, plus a 50ms sample of `data-sl-theme`, the computed body background and `--theia-editor-background` — can be read back from the profile after the app exits, with nothing to copy by hand. It showed the renderer was never light at any point, which is what moved the search out of the page.

See [[electron-prefers-color-scheme]] and [[theia-colors-css-vs-registry]] for the two theories this replaced.
