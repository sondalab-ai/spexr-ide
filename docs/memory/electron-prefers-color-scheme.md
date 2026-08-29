---
name: electron-prefers-color-scheme
description: In Electron prefers-color-scheme follows nativeTheme.themeSource, which Theia pins to the app's own theme — so it is not the OS setting
metadata:
  type: reference
---

`window.matchMedia('(prefers-color-scheme: dark)')` does not report the operating system's setting in this application. In Electron the renderer's media query follows `nativeTheme.themeSource`, and Theia pins that to the application's own theme: `ElectronMenuContribution.handleThemeChange` calls `setTheme(...)`, which sets `nativeTheme.themeSource` in the main process. From that moment the query answers with the app's theme, not the OS's.

The window between the two answers is real and visible. It produced a ~550ms light flash at startup that survived four wrong fixes:

1. HTML parse — `themeSource` is still `'system'`, so the query reports the OS honestly (light).
2. The bundle loads, Theia restores its own theme from localStorage `theme` (dark) and pins `themeSource` to it.
3. Anything reading the query after that gets dark.

Because nothing ever wrote `spexr.theme`, the app's theme was decided entirely by step 3 — a side effect, not a preference. The startup guard in `apps/desktop/preload.html` was reading the query at step 1 and painting the light canvas.

**Consequences to keep in mind:**

- The only honest read of the OS preference is at HTML parse time, before the bundle runs. The guard records it in localStorage `spexr.os.dark`; `SpexrThemeContribution.systemPreference()` reads that rather than querying live.
- "Follow the OS" is effectively dead in Electron once `themeSource` is pinned: a genuine OS change fires no event, because the renderer is no longer on `system`.
- Theia's restored color theme is the source of truth when the user expressed no SPEXR-specific choice — it is the only thing that actually persists a decision. `spexr.theme` means "the user chose this", and its absence is what keeps the OS path alive; `spexr.theme.last` records what was rendered, for the startup guard only.

See [[theia-colors-css-vs-registry]] for the related trap, and [[theme-architecture]] for the token layer.
