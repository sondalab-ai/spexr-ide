---
name: spexr-idle-cpu-2026-09-25-plain-git-status-creates-deletes-g
description: SPEXR idle CPU (2026-09-25): plain 'git status' creates/deletes .git/index.lock even with no changes, so SPEXR's .git watcher and Theia's file watcher re-trigger status refresh across all repos in a ~2 Hz loop; read-only git calls need GIT_OPTIONAL_LOCKS=0 (--no-optional-locks).
metadata:
  node_type: memory
  loadout_kind: memory
  scope: repo
  created: 2026-09-25
---
