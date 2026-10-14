---
name: amounts-are-integer-cents
description: Money is stored as integer cents everywhere; never parse amounts with parseFloat.
type: project
---

Every amount in the ledger and in parsed rows is an integer number of cents.

**Why:** float rounding broke reconciliation of a 0.10 + 0.20 pair in September.
**How to apply:** go through `toCents` in src/import/csv.ts.
