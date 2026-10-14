---
slug: 0002-date-locales
title: Date locales
status: validated
owner: Mae Brook
createdAt: 2026-09-20
---

## Goal

Read both day-first and month-first statement dates without guessing.

## Non-goals

- Detecting the locale from the file contents

## Acceptance Criteria

- **AC-1** The importer reads en-GB dates as day, month, year.
- **AC-2** The importer reads en-US dates as month, day, year.
- **AC-3** An impossible date fails the import and names the line it came from.
