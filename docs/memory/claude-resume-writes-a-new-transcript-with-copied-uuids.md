---
name: claude-resume-writes-a-new-transcript-with-copied-uuids
description: A Claude resume writes a new transcript with the history copied in, message uuids kept; a compacted resume starts at the compact_boundary uuid; the first line can exceed the 32 KB head read.
metadata:
  type: reference
---

Resuming a Claude session (`--resume`, fork or not) writes a **new** `<sessionId>.jsonl` with the conversation copied in. Every copied entry keeps its `uuid` but gets the new `sessionId`, so one conversation leaves a chain of transcripts, each a prefix-snapshot of the next. The older copy's last uuid appears in the newer one.

A resume after a compaction copies only from the compaction on. The copy's first uuid entry is a `system`/`compact_boundary` with `parentUuid: null`. Its uuid and timestamp match the boundary line in the middle of the original, often hundreds of KB before the original's end.

A transcript's first line can be a single attachment larger than the 32 KB bounded head read. In that case the head holds no message at all, and anything taken from the head (root uuid, goal) silently falls through to the tail.

**How to apply:** Dark Factory folds these chains in `session-lineage.ts`. It groups transcripts by root uuid, links compacted copies by searching the original for the boundary uuid, and treats an older copy as superseded only when a newer one contains its tip uuid. It reads the root with its own stream, not the bounded head. Related: [[a-claude-session-resumed-from-a-spexr-dark-factory-card-runs]].
