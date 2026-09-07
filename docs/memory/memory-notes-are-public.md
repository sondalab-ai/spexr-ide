---
name: Memory notes are public
description: docs/memory/ ships in a public repo — keep employers, addresses, account details and machine paths out of the notes.
type: feedback
---

`sondalab-ai/spexr-ide` is a public repository, so everything written under
`docs/memory/` lands in public git history the moment it is committed.

**Why:** debugging notes are the natural place for the details that made a bug
reproducible — an organisation name, an email, which subscription an account is
on — and those are exactly what must not be published. It is reversible only by
rewriting history.

**How to apply:** write the reusable fact, not the incident. State the mechanism
("the keychain entry differs by whether the variable is set") rather than whose
accounts revealed it. Personal or machine-specific context belongs in
`~/.claude/projects/<slug>/memory/` instead.
