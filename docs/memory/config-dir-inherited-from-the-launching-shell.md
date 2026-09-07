---
name: Config dir inherited from the launching shell
description: SPEXR inherits CLAUDE_CONFIG_DIR from the shell that started it, which leaks into anything that does not set the account explicitly.
type: project
---

The backend process inherits `CLAUDE_CONFIG_DIR` from whatever shell launched
SPEXR, so any launch path that neither exports nor unsets it hands the session
an account nobody chose. The same value also reaches the frontend indirectly,
through anything derived from the backend environment.

**Why:** developers commonly start SPEXR from a terminal where they have been
using a wrapper alias that sets the variable, so the leak is the normal case
rather than an edge case.

**How to apply:** every launch path sets the account authoritatively in its own
shell line — `export` for a non-default account, `unset` for the default one and
for a command that owns the account itself. When debugging which account a
session used, check where its transcript landed under `<configdir>/projects/`
rather than trusting how the session behaves; see
[[which-claude-account-a-config-dir-uses]].
