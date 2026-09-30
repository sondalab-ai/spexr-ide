---
name: claude-theme-lives-in-settings-json
description: Claude Code reads its theme from settings.json, not ~/.claude.json; a stale "theme" there silently disables Auto (match terminal)
metadata:
  type: reference
---

Claude Code (2.1.285) takes `theme` from `settings.json` in the config dir. A `"theme"` key in `.claude.json` is ignored when `settings.json` sets one, so setting `"auto"` only in `.claude.json` changes nothing.

With `"dark"` in `settings.json`, Claude never sends the OSC 11 background query and draws its dark palette (Monokai-yellow strings, dark diff bands, `rgb(153,153,153)` dim text) on SPEXR's light terminal. Mode 2031 is still set, so the terminal side looks fine.

With `"auto"`, Claude asks OSC 11 at startup, and xterm 5.3 answers with its real canvas background. Claude picks light when the luminance is above 0.5. The `--debug-file` log shows `systemTheme: OSC 11 response=... detected=light`. On a theme-change report (`CSI ?997;1n/2n`, see `terminal-theme-report.ts`), it asks again.

To check without SPEXR, run `claude --settings '{"theme":"auto"}' --debug-file <f>` in a pty that answers `ESC]11;?`, then grep the log for `systemTheme`. See [[theia-colors-css-vs-registry]].
