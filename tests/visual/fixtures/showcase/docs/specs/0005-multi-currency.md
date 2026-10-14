---
slug: 0005-multi-currency
title: Multi-currency accounts
status: draft
owner: Mae Brook
createdAt: 2026-09-20
---

## Goal

Reconcile accounts whose statements hold rows in more than one currency.

## Non-goals

- Fetching exchange rates
- Showing balances converted to one currency

## Acceptance Criteria

- **AC-1** Each row keeps the currency code the bank exported with it.
- **AC-2** Rows only match ledger entries recorded in the same currency.
