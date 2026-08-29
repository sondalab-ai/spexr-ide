---
name: theia-backend-orphans
description: Theia kills the forked backend only on app.on('quit'), so an unclean main-process death leaves it running forever
metadata:
  type: reference
---

Theia's `ElectronMainApplication.startBackend()` forks the backend and registers exactly one teardown: `app.on('quit')`. Any death of the Electron main process that skips a clean quit — `kill -9`, a crash, `pkill Electron` — leaves the backend alive and reparented to init (PPID 1). Nothing ever collects it.

An orphaned SPEXR backend is not idle: it keeps the Darkfactory transcript scan running, holds the resident model worker (`description-worker.js`), and owns every agent terminal it spawned. Several of them accumulate silently across development sessions. Four at once (one of them 10 days old) scanning the same transcripts produced

```
[darkfactory] backend event loop blocked ~3967ms
```

from an application whose windows were all closed — a symptom with no visible cause, because the app "wasn't running".

**Detection:** `ps -eo pid,ppid,etime,command | grep src-gen/backend/main.js`. PPID 1 with no `Electron.app/Contents/MacOS/Electron` main process alive means orphaned.

**Fix in the repo:** `SpexrParentWatchdog` (`src/node/spexr-parent-watchdog.ts`, bound as a `BackendApplicationContribution`) watches two signals, because neither covers everything:

- the IPC channel to the parent closing (`process.on('disconnect')`) — immediate, and the normal case since the backend is forked with a channel;
- `process.ppid` becoming 1, polled — covers a parent that died without the channel reporting it, and `--no-cluster`, where there is no channel at all.

It raises `SIGTERM` on itself rather than calling `process.exit`. That matters: Theia's own shutdown handlers are what stop the terminals and the model worker, and exiting directly would just move the orphans one level down. Verified empirically — a plain `SIGTERM` to an orphaned backend took its whole process tree with it.

The model worker carries the same guard (`process.on('disconnect')` → exit) for the case where the backend itself is killed outright.
