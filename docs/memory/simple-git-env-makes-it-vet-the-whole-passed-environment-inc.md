---
name: simple-git-env-makes-it-vet-the-whole-passed-environment-inc
description: simple-git .env() makes it vet the WHOLE passed environment (incl. GIT_CONFIG_COUNT/KEY/VALUE entries): an inherited EDITOR/PAGER/GIT_EDITOR/credential helper throws 'not permitted without enabling allowUnsafe*' on every call unless those unsafe categories are granted. spexr's backgroundFetch never worked before 2026-09-25 because its own GIT_ASKPASS tripped this.
metadata:
  node_type: memory
  loadout_kind: memory
  scope: repo
  created: 2026-09-25
---
