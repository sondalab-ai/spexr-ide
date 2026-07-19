---
slug: 0005-drift-detector
title: Real drift detector — code-vs-spec divergence
status: shipped
createdAt: 2026-05-24
relatedSpecs: 
workflowStep: ship
updatedAt: 2026-07-15
forcedSteps: [ship]
---
## Goal

Replace the structural-only `StructuralDriftDetector` (`packages/spec/src/drift-detector.ts`) with a detector that actually answers "does the code still satisfy this spec's acceptance criteria?". This is the engine behind Pillar #2 ("a drift detector flags divergence") — today it only checks that a spec *has* a Goal and AC section, never whether the code matches them.

The detector resolves the files a spec touches, gathers their current state, and asks the active Claude session to evaluate each acceptance criterion against that code, producing per-AC findings (`ok` / `warn` / `block`) that feed the existing `WorkflowProgress` and the `validate` → `ship` gate (`packages/spec/src/workflow.ts`).

## Non-goals

- Continuous/background drift watching (this spec runs on demand, from the workflow stepper or a command).
- A separate diffing UI; findings render in the existing spec workflow surface.
- Replacing human review — drift findings advise the `validate` step, they do not auto-advance status.
- Multi-spec batch evaluation (one spec at a time).

## File resolution

A spec's implicated files come from two sources, unioned:

1. **Commit trailers** — `git log --grep "Spec: <slug>"` collects commits carrying the `Spec: <slug>` trailer (the convention already documented in `packages/spec/src/types.ts:3`); their changed paths are the spec's footprint.
2. **Spec links** — explicit file references inside the spec body (markdown links / inline code paths that resolve to a real file under the workspace).

The union is filtered to existing, in-workspace, non-ignored paths.

## Acceptance Criteria

- **AC-1** A new `AgentDriftDetector implements DriftDetector` resolves implicated files from `Spec: <slug>` commit trailers plus in-body spec links; when no files resolve it returns a single `warn` finding ("no code linked to this spec yet") rather than an empty clean report.
- **AC-2** For each acceptance criterion the detector asks the active Claude session (via the agent surface from spec 0003) to judge the criterion against the resolved file contents and return a structured verdict (`criterionId`, `severity`, `message`, optional `suggestion`). Malformed or missing agent output for a criterion degrades to a `warn`, never a crash.
- **AC-3** The structural checks from `StructuralDriftDetector` (missing Goal, missing AC) are preserved and run first; if a `block`-level structural problem exists, the agent pass is skipped (nothing to evaluate against).
- **AC-4** The resulting `DriftReport` flows unchanged into `validateOrShip` (`workflow.ts`): any `block` finding holds the spec at `validate`; otherwise `ship` becomes reachable. `checkedAt` records the run timestamp.
- **AC-5** A `spexr.spec.checkDrift` command runs the detector for the active spec and surfaces the report (findings list with severity + file hints); the workflow stepper exposes it as the action for the `validate` step.

## Testing

- File resolution: trailer-derived paths + link-derived paths are unioned and filtered to existing in-workspace files; ignored/non-existent paths dropped (`packages/spec`).
- Structural-block short-circuit: a spec with no AC yields the structural `block` and no agent call (`packages/spec`).
- Report → gate: a report with a `block` finding keeps `validateOrShip` at `validate`; an all-`ok`/`warn` report reaches `ship` (extends existing `workflow.test.ts`).
- Agent verdict parsing: well-formed structured output maps to findings; malformed output degrades to `warn`.

## Notes

- The agent evaluation reuses the single embedded terminal/session — no new transport. Prompt shape and the structured-output contract should live next to `buildSystemPrompt` in `@spexr/agent`.
- Cost is proportional to file size × criteria count; cap the bytes sent per file and note truncation in the finding when it happens.
