---
slug: 0008-plan-task-artifacts
title: Plan & task artifacts derived from a spec
status: validated
workflowStep: ship
createdAt: 2026-05-24
updatedAt: 2026-07-19
relatedSpecs: 
forcedSteps: [ship]
---
## Goal

Make the `plan` workflow step produce a real, persisted artifact. The data model already anticipates it — `Task.planStepId` exists (`packages/spec/src/types.ts:73`) and the step label reads "Draft plan steps linked to AC" (`workflow.ts:103`) — but no plan is ever generated or stored; `plan` is only a state label. This spec lets the agent draft a plan of tasks from a spec's acceptance criteria, persists it next to the spec, and tracks task completion so progress is visible and resumable.

## Non-goals

- Auto-executing tasks (the agent proposes and the user drives; execution stays in the normal implement loop).
- A Gantt/board UI; v1 is a checklist linked to AC.
- Cross-spec planning or dependency graphs between specs.

## Data model

A plan persists as `docs/specs/.context/<NNNN-slug>/_plan.md` (alongside existing per-spec context, spec 0006), frontmatter + checklist:

```md
---
specSlug: <NNNN-slug>
generatedAt: <iso>
---

- [ ] T1 (AC-1): <task text>
- [ ] T2 (AC-1): <task text>
- [x] T3 (AC-2): <task text>
```

Each task carries an id, the `planStepId`/AC it serves, and a done flag — matching the existing `Task` type.

## Acceptance Criteria

- **AC-1** `spexr.spec.plan` asks the active session to draft tasks for the spec, each task tagged with the acceptance criterion it advances; the result is written to `_plan.md`. Re-running offers to regenerate (replace) or merge, never silently discards completed tasks.
- **AC-2** Every generated task references a real AC id of the spec; tasks that map to no AC are rejected/flagged rather than written.
- **AC-3** The spec workflow stepper renders the plan as a checklist under the `plan` step; toggling a task checkbox persists `[ ]`/`[x]` back to `_plan.md`.
- **AC-4** Plan completeness feeds `WorkflowProgress`: the `plan` step counts as done only when a `_plan.md` exists with at least one task; `implement` reflects the share of tasks checked.
- **AC-5** Parsing tolerates hand-edited `_plan.md` (a user may add/check tasks by hand); malformed lines are skipped without dropping valid ones.

## Testing

- Round-trip: generated `_plan.md` parses back to the same tasks; checkbox toggle persists (`packages/spec`).
- AC binding: a task tagged with an unknown AC id is rejected (unit).
- Progress: zero tasks → `plan` pending; all checked → `implement` reflects 100% (extends `workflow.test.ts`).
- Hand-edit tolerance: a file with one malformed line keeps the valid tasks.

## Notes

- Storing the plan under the spec's existing `.context/<slug>/` dir keeps all per-spec artifacts together (spec 0006) and out of the source tree.
- Tasks reference AC ids, so plan completion and drift findings (spec 0005) speak the same vocabulary — useful when validating that every AC was both planned and satisfied.
