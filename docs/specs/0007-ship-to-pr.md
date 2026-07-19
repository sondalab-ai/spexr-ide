---
slug: 0007-ship-to-pr
title: Ship step — branch, commit trailer, open PR
status: shipped
workflowStep: ship
createdAt: 2026-05-24
updatedAt: 2026-07-15
relatedSpecs: 
---
## Goal

Turn the `ship` workflow step from a prompt into an action. Today the step is the label "Open PR with `Spec: <slug>` trailer" (`packages/spec/src/workflow.ts:106`) delivered as an `agent-prompt` — the human is told what to do, nothing is automated. This spec wires a real command that closes the spec → diff → PR loop and guarantees the `Spec: <slug>` trailer the drift detector (spec 0005) relies on.

## Non-goals

- Auto-generating the diff (code changes are produced by the agent during `implement`; this spec packages an existing diff, it does not write code).
- Merging PRs or managing review (open only).
- Hosting providers beyond GitHub via `gh` in v1 (the trailer convention is provider-neutral; the PR-open path starts with `gh`).

## Acceptance Criteria

- **AC-1** `spexr.spec.ship` is enabled only when the spec's workflow resolves to `ship` (no `block` drift finding); otherwise it is disabled with a tooltip pointing at the blocking step.
- **AC-2** Running ship, when on the default branch, creates a `spec/<NNNN-slug>` branch first; on an existing feature branch it reuses it. It never commits directly to the default branch.
- **AC-3** Staged changes are committed with a message whose body ends with the `Spec: <slug>` trailer; if there are no changes to commit and no unpushed commits, the command reports "nothing to ship" and stops.
- **AC-4** The branch is pushed and a PR is opened via `gh`, titled from the spec title, body linking the spec and listing its acceptance criteria. The resulting PR URL is surfaced to the user.
- **AC-5** Missing `gh`, missing auth, or no git remote each surface as a distinct actionable error (not a generic failure), and leave the local branch/commit intact so the user can finish manually.
- **AC-6** On success the spec status advances to `validated`/ship-complete per the existing status model, and the workflow stepper reflects it.

## Testing

- Trailer presence: generated commit message body ends with exactly `Spec: <slug>` (unit on the message builder).
- Branch guard: on default branch → new `spec/<slug>` branch; on feature branch → reuse (mock git).
- Empty change set → "nothing to ship", no commit, no push.
- Error mapping: absent `gh` / absent remote produce their specific messages (mock).

## Notes

- Reuses the workspace git + `gh`, consistent with the README "Git required" adopter prerequisite.
- Commit/push are user-triggered through this command — it does not run on save or autostart.
- The `Spec: <slug>` trailer is the contract shared with spec 0005's file resolution; keep the trailer format in one shared constant.
