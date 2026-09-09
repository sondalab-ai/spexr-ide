---
name: darkfactory-push-reaches-only-the-newest-window
description: SpexrDarkfactoryBackendService is a singleton with one `client` field, so onTilesChanged/onFollowChunk reach only the most recently connected window — a second window silently steals the push channel.
metadata:
  node_type: memory
  loadout_kind: memory
  scope: repo
  created: 2026-09-09
---

`spexr-backend-module.ts` binds `SpexrDarkfactoryBackendService` `.inSingletonScope()` and the
`RpcConnectionHandler` calls `service.setClient(client)` for every connection. The field is a single
`client?: SpexrDarkfactoryClient`, so opening a second window overwrites the first one's client and
only the newest window receives `onTilesChanged`, `onFollowChunk` and `onSessionIndexProgress`.

Anything that relies on a push to propagate a change across windows (session rename, live tiles) is
therefore single-window. Fixing it means holding a set of clients and fanning out, not a single field.
