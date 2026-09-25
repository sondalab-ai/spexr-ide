---
name: a-read-only-opencode-db-query-still-writes-its-data-dir-open
description: A read-only 'opencode db' query still writes its data dir (opencode.db, -shm, log/, repos/) - verified 2026-09-25 on a copy via XDG_DATA_HOME. Dark Factory watches that dir, so each scan's own query re-triggers the next scan (~2 spawns/s even with opencode not running).
metadata:
  node_type: memory
  loadout_kind: memory
  scope: repo
  created: 2026-09-25
---
