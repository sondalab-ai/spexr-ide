---
slug: 0001-csv-import
title: CSV statement import
status: shipped
owner: Mae Brook
createdAt: 2026-09-20
---

## Goal

Read the CSV statements the bank lets users download, so nobody types transactions by hand.

## Non-goals

- Bank APIs or screen scraping
- Formats other than CSV

## Acceptance Criteria

- **AC-1** The importer reads Date, Description and Amount columns from a file with a header line.
- **AC-2** A quoted description that contains commas is kept as one field.
- **AC-3** Amounts are stored as integer cents and never pass through floating point.
