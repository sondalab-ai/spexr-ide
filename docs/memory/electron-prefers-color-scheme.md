---
name: electron-prefers-color-scheme
description: In Electron prefers-color-scheme follows nativeTheme.themeSource, which Theia pins to the app's own theme — so it is not the OS setting
metadata:
  type: reference
---

`window.matchMedia('(prefers-color-scheme: dark)')` does not report the operating system's setting in this application. In Electron the renderer's media query follows `nativeTheme.themeSource`, and Theia pins that to the application's own theme: `ElectronMenuContribution.handleThemeChange` calls `setTheme(...)`, which sets `nativeTheme.themeSource` in the main process. From that moment the query answers with the app's theme, not the OS's.

There are therefore two different answers depending on when you ask:

1. At HTML parse, before the bundle runs, `themeSource` is still `'system'` and the query is honest.
2. Once Theia has restored and applied its own theme, the query echoes that theme back.

**Consequences to keep in mind:**

- The only honest read of the OS preference is at parse time. The startup guard in `apps/desktop/preload.html` records it in localStorage `spexr.os.dark`; `SpexrThemeContribution.systemPreference()` reads that rather than querying live.
- "Follow the OS" is effectively dead in Electron once `themeSource` is pinned: a genuine OS change fires no event, because the renderer is no longer on `system`.
- Theia's restored color theme is the source of truth when the user expressed no SPEXR-specific choice — it is the only thing that actually persists a decision. `spexr.theme` means "the user chose this", and its absence is what keeps the OS path alive; `spexr.theme.last` records what was rendered, for the startup guard only.

**What this is not.** This was wrongly blamed for the startup colour flash, and the fixes built on that theory did nothing. The flash was the Electron window's own background — see [[electron-window-background-flash]]. Keep the two apart: this note is about *theme resolution*, not about what is painted before the document exists.

See [[theia-colors-css-vs-registry]] for a related trap, and [[theme-architecture]] for the token layer.
