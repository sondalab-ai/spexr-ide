---
slug: 0003-reconcile-window
title: Reconcile within a date window
status: in-progress
workflowStep: plan
owner: Mae Brook
createdAt: 2026-09-20
---

## Goal

Match a statement row to a ledger entry even when the bank books it a few days later.

## Non-goals

- Partial payments that split one entry across rows
- Matching by description text

## Acceptance Criteria

- **AC-1** A row matches an entry dated up to three days earlier or later.
- **AC-2** Amounts that differ by one cent of rounding still match.
- **AC-3** When two rows fit one entry, the row with the closest date wins it.
- **AC-4** Rows that match nothing are reported with the reason they failed.

## Notes

Code: `src/reconcile/match.ts` and `src/import/dates.ts`.
