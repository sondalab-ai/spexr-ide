---
slug: 0006-spec-context-fan-in
title: Automatic spec-context fan-in to the agent
status: shipped
createdAt: 2026-05-24
workflowStep: ship
updatedAt: 2026-07-15
relatedSpecs: 
---
## Goal

Make the per-spec context store (`docs/specs/.context/<NNNN-slug>/`) actually reach the agent. Today context is storage-only: files and `_links.md` sit next to the spec but are never loaded — the README states "Context is storage-only for now ... ready for the agent to load on a future handoff." This spec is that handoff.

When the user runs **Send to agent** for a spec, SPEXR assembles the spec body plus its context (copied files + recorded links) into the launch context, so the session starts already grounded in the supporting material instead of just the spec text.

## Non-goals

- Fetching remote URL contents from `_links.md` (links are passed as references, not crawled — crawling is a later spec).
- Retrieval/embedding-based selection; v1 includes the spec's context in full, bounded by a size budget.
- Editing context from the agent side (still added via the existing Spec view actions).

## Acceptance Criteria

- **AC-1** `buildSpecHandoff(spec)` collects the spec body, the files under `docs/specs/.context/<slug>/` (excluding `_links.md`), and the entries parsed from `_links.md`, into a single ordered context payload: spec body first, then file contents (each delimited with its filename), then a links section listing label + URL.
- **AC-2** The existing **Send to agent** action (`spexr.spec.handoff`) uses `buildSpecHandoff` instead of sending the spec body alone; with no context present the payload is identical to today's body-only handoff (backward compatible).
- **AC-3** A total byte budget caps the payload; when exceeded, files are included newest-first until the budget is hit and a truncation notice names the omitted files. The spec body and links section are never dropped.
- **AC-4** Binary / non-text files in the context dir are listed by name as "attached (not inlined)" rather than dumped as bytes.
- **AC-5** The handoff respects the active expert persona (spec 0004): context is layered into the same launch context, after the persona section, without altering persona precedence.

## Testing

- Assembly order + delimiters: body, then files, then links (`packages/spec` or `@spexr/agent`).
- `_links.md` parse: `- [label](url) — date` round-trips into the links section; malformed lines skipped.
- Budget: oversized context drops oldest files first, keeps body + links, emits truncation notice.
- Backward compat: spec with empty/absent `.context/<slug>/` produces the body-only payload byte-for-byte.

## Notes

- File copy/link recording is unchanged (spec context section of the README) — this spec only consumes what is already stored.
- Keep the assembler in a Theia-agnostic package (`@spexr/spec` reading via injected fs, or `@spexr/agent`) so it stays unit-testable without Theia.
