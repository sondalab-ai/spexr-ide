---
slug: 0006-export-report
title: Reconcile report export
status: draft
owner: Mae Brook
createdAt: 2026-09-20
---

## Goal

Give the accountant a file that shows what matched and what did not.

## Non-goals

- A PDF layout

## Acceptance Criteria

- **AC-1** The report command writes matched and unmatched rows to one CSV file.
- **AC-2** Each unmatched row in the report carries the reason it failed to match.
