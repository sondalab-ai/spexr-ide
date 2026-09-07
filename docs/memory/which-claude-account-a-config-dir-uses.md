---
name: Which Claude account a config dir uses
description: read it with `CLAUDE_CONFIG_DIR=<dir> claude auth status`; the keychain entry depends on whether the variable is set at all.
type: reference
---

`oauthAccount` in `.claude.json` can be stale: it may name an account the live
token no longer belongs to. The authoritative answer comes from
`CLAUDE_CONFIG_DIR=<dir> claude auth status`, which reports the email,
organisation and subscription actually in use, plus the `projectsDirectory` the
config dir resolves to.

**Why:** Claude Code keeps the OAuth token in the macOS keychain, one entry per
config dir (`Claude Code-credentials-<hash>`), and picks a *different* entry
depending on whether `CLAUDE_CONFIG_DIR` is set at all — even when the path is
the default `~/.claude`. Two entries for the same directory can therefore hold
two different logins, and a re-authentication done in a plain terminal only
updates the unset one.

**How to apply:** never infer the account from a session's behaviour — global
instructions are often shared between accounts. Compare `auth status` per config
dir. In SPEXR this is why the default account is named by *unsetting* the
variable rather than exporting `~/.claude`; see `exportFor` in
`claude-launch-profiles.ts`.
