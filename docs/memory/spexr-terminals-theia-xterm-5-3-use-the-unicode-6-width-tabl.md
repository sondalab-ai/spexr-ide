---
name: spexr-terminals-theia-xterm-5-3-use-the-unicode-6-width-tabl
description: SPEXR terminals (Theia xterm 5.3) use the Unicode 6 width table: every emoji above U+1FFFF is 1 cell wide, but Claude Code treats them as 2, causing overlapping icons and stale characters like 'fmain'. Fix: load xterm-addon-unicode11@0.6.0 and set activeVersion 11; term.unicode requires allowProposedApi.
metadata:
  node_type: memory
  loadout_kind: memory
  scope: repo
  created: 2026-09-24
---
