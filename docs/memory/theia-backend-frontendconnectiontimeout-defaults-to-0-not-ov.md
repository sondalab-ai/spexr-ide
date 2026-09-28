---
name: theia-backend-frontendconnectiontimeout-defaults-to-0-not-ov
description: Theia backend frontendConnectionTimeout defaults to 0 (not overridden in apps/desktop/package.json): on wake from sleep socket.io 'ping timeout' makes the backend close the window's connection immediately, so reconnect fails and terminals go dead. -1 is safe in Electron: close sends markForClose, reload reuses the same webcontentId.
metadata:
  node_type: memory
  loadout_kind: memory
  scope: repo
  created: 2026-09-26
---
