---
name: electron-single-instance-lock
description: A second SPEXR instance quits silently while one is already running, so a rebuilt app appears to have changed nothing
metadata:
  type: reference
---

The generated `src-gen/backend/electron-main.js` calls
`app.requestSingleInstanceLock(process.argv)` and, when the lock is already
held, calls `app.quit()` and returns. `src-gen/` is git-ignored and regenerated
by `theia build`, so this line does not turn up in a grep of the repository.

The failure mode it produces is misleading rather than loud. `pnpm dev` builds
correctly, then Electron exits after printing only

```
Electron main: loading modules... [0.8 s since electron main start]
```

and the already-running window — which is still executing the *previous* build —
takes focus. Nothing looks broken, so the natural reading is "my change had no
effect", and the next move is to debug a change that was never loaded.

**Before verifying anything in the UI, quit the running SPEXR.** `ps aux | grep
Electron` shows it; a window from an earlier session counts.

Running the backend on its own (`node src-gen/backend/main.js --port=…`) is not
a way around this for UI work: it takes no lock and boots fine, which makes it
useful for checking backend-only behaviour such as plugin deployment, but
`SpexrParentWatchdog` shuts it down a few seconds after the launching shell
exits, so it has to be started by a process that stays alive. See
[[theia-backend-orphans]].
