---
slug: 0004-duplicate-detection
title: Duplicate detection
status: draft
owner: Mae Brook
createdAt: 2026-09-20
---

## Goal

Stop the same statement from being imported twice when its date ranges overlap.

## Non-goals

- Merging duplicates that differ in description

## Acceptance Criteria

- **AC-1** Importing a file whose rows were all imported before adds nothing to the ledger.
- **AC-2** An overlapping import adds only the rows that are new and says how many it skipped.
