---
name: never-run-full-pnpm-test-or-the-full-e2e-suite-unthrottled-i
description: Unthrottled test runs crashed the 18 GB dev machine on 2026-09-24 (turbo ran ~10 packages at once, each vitest forking cores-1). Test scripts now cap it (--maxWorkers=2, turbo --concurrency=2); keep the caps, prefer focused tests, and run e2e with a --user-data-dir per launch when a SPEXR instance is open.
metadata:
  node_type: memory
  loadout_kind: memory
  scope: repo
  created: 2026-09-24
---
