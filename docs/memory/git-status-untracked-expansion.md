---
name: git-status-untracked-expansion
description: SPEXR's SCM panel lists every untracked file while terminal `git status` collapses untracked directories, so the two counts differ legitimately.
metadata:
  type: reference
---

`git status` from a terminal defaults to `-unormal`, which collapses a wholly
untracked directory into a single `?? path/` line. SPEXR's backend uses
simple-git, whose `status()` runs `git status --porcelain -b -u` — and bare `-u`
means `-uall`, so every file inside such a directory becomes its own row.

A repository with two untracked directories therefore reads "2" in the terminal
and "49" in the panel, with neither being wrong. VS Code behaves like SPEXR here,
and switching to `-unormal` is not an option: a collapsed directory row cannot be
staged, diffed, or rendered as a tree node.

Diagnosed 2026-09-08 on `~/src/camunda-hub`, where the 47 extra rows were
Playwright artifacts (`playwright-report/`, `test-results/`) that predated the
pull the user suspected. The fix was presentational: a separate "Untracked"
resource group in the SCM panel, so the two kinds of row count apart.
