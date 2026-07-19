> **What is this file.** Implementation contract for **force-complete on workflow
> steps** — lets a user manually mark the current spec-workflow step as done when
> its own auto-completion signal (acceptance criteria authored, context attached,
> plan generated, drift check clean, etc.) hasn't fired yet, or never will for a
> legitimate reason. It extends the workflow stepper introduced in
> `docs/specs/0008-plan-task-artifacts.md` (plan/task checklist) and the auto-advance
> engine in `packages/spec/src/workflow.ts`; those are unchanged except where noted.
> **Audience:** engineer implementing the change, reviewer of the implementation plan.
> **Owner:** marcello.barile.
> **Companion files:** `docs/specs/0008-plan-task-artifacts.md` defines the
> acceptance criterion (AC) and `PlanTask` vocabulary reused here; the
> implementation plan (`docs/superpowers/plans/`) is the build order once this is
> approved.

# Force-complete on workflow steps

## Status legend

- **Shipped** — merged, available to users.
- **Planned** — designed here, not built.

Everything below is **Planned**.

## Problem

The spec workflow stepper (`specify → context → clarify → plan → implement →
validate → ship`) advances each step automatically from filesystem/frontmatter
signals via `resolveCurrentStep()` (`packages/spec/src/workflow.ts:69-96`) — e.g.
`specify` needs a real AC authored, `plan` needs `_plan.md` to exist, `validate`
needs no `block`-severity drift finding. There is no way to advance past a step
whose signal hasn't fired, even when the user knows — for reasons outside what the
detector checks — that the step is in fact done. Today the only escape is editing
the spec's frontmatter by hand.

## Goal

Any workflow step that has an auto-completion signal must also support a manual
override: "force this step complete," gated so it cannot skip an incomplete
predecessor, reversible, and flagged when the underlying signal still disagrees.

## Non-goals

- No visual distinction between "auto-completed" and "forced" steps beyond the
  disagreement warning below (confirmed: not needed).
- No forcing of steps other than the current one (no jumping ahead to force a
  future `pending` step directly).
- No re-implementation of each step's real action (open editor, send agent
  prompt, run drift check) — force is a parallel, explicit override path, not a
  replacement for those actions.

## Design

### 1. Data model — `packages/spec/src/types.ts`

Add an optional field to `SpecFrontmatter` (`types.ts:34-43`):

```ts
export interface SpecFrontmatter {
  // ...unchanged fields
  readonly forcedSteps?: readonly WorkflowStep[];
}
```

Persisted in the spec's own YAML frontmatter block, same file
(`docs/specs/<slug>.md`) already used for `status`/`workflowStep`. Absent field
means no step has ever been forced — no migration needed for existing specs.

`forcedSteps` is append/pop-only in practice (see `forceCompleteStep`/
`unforceStep` below), so it always holds a prefix of `WORKFLOW_STEP_ORDER`
consistent with whatever the natural signals have already cleared.

### 2. Domain logic — `packages/spec/src/workflow.ts`

Two new pure functions, next to `resolveCurrentStep`/`computeProgress`:

```ts
export interface ForceResult {
  readonly ok: boolean;
  readonly forcedSteps: readonly WorkflowStep[];
  readonly error?: string;
}

export function forceCompleteStep(
  frontmatter: Pick<SpecFrontmatter, "status" | "workflowStep" | "forcedSteps">,
  signals: WorkflowSignals,
  step: WorkflowStep,
): ForceResult;

export function unforceStep(
  frontmatter: Pick<SpecFrontmatter, "forcedSteps">,
  step: WorkflowStep,
): ForceResult;
```

`forceCompleteStep`:
1. Computes the **natural** current step via the existing `resolveCurrentStep`
   (unchanged), and the **effective** current step via `effectiveCurrentStep`
   below.
2. Rejects (`ok: false`, `error` message reused by the caller for the warning
   toast, same wording style as `warnDependency()` in
   `spexr-commands-contribution.ts:436-450`) unless `step === effectiveCurrentStep`.
   Since the UI only ever offers the force action on the current step (§3), this
   is a defense-in-depth check, not the primary gate.
3. On success, appends `step` to `forcedSteps` and returns the new array.

`unforceStep`:
1. Rejects unless `step` is the **last** (highest-index) entry in
   `forcedSteps` — matches "undo the step you just forced," a stack, not
   arbitrary removal.
2. On success, pops it and returns the new array.

New helper, also exported:

```ts
export function effectiveCurrentStep(
  frontmatter: Pick<SpecFrontmatter, "status" | "workflowStep" | "forcedSteps">,
  signals: WorkflowSignals,
): WorkflowStep | "done" {
  const natural = resolveCurrentStep(frontmatter, signals);
  const forced = frontmatter.forcedSteps ?? [];
  if (forced.length === 0) return natural;
  const forcedIdx = WORKFLOW_STEP_ORDER.indexOf(forced[forced.length - 1]);
  const naturalIdx = natural === "done" ? WORKFLOW_STEP_ORDER.length : WORKFLOW_STEP_ORDER.indexOf(natural);
  const idx = Math.max(naturalIdx, forcedIdx + 1);
  return idx >= WORKFLOW_STEP_ORDER.length ? "done" : WORKFLOW_STEP_ORDER[idx];
}
```

Taking `Math.max` means if the real signals catch up on their own after a force
(e.g. the user later authors real AC after forcing `specify`), the natural
progression wins and nothing regresses.

`computeProgress()` keeps its current signature but callers now pass
`effectiveCurrentStep(...)` instead of `resolveCurrentStep(...)` when they need
the state the stepper renders. `resolveCurrentStep` itself is untouched.

**Per-step "is this forced step's signal actually satisfied" (for the warning
icon):** derived at the call site, not stored — compare `natural` (from
`resolveCurrentStep`, ignoring force) against each forced step's index:

```ts
const naturalIdx = natural === "done" ? WORKFLOW_STEP_ORDER.length : WORKFLOW_STEP_ORDER.indexOf(natural);
const signalVerified = (step: WorkflowStep) => naturalIdx > WORKFLOW_STEP_ORDER.indexOf(step);
```

(Exact helper shape decided during implementation; the contract is: a forced step
shows the warning iff the natural, signal-only computation has not independently
reached past it.)

### 3. UI — `packages/theia-extensions/src/browser/views/spec-workflow-stepper.tsx`

`StepButton` gains a small hover-only overlay icon layer, plus one always-visible
icon:

- **Force icon** (e.g. a check-in-circle glyph), shown on hover **only when
  `state === "current"`**. Click calls a new `onForceStep(step)` prop — does not
  trigger the existing `onStepClick` action.
- **Un-force icon** (undo glyph), shown on hover **only on the step that is the
  last entry of `forcedSteps`**, i.e. the step immediately before the current one
  when it was forced. Click calls a new `onUnforceStep(step)` prop. Only one step
  can show this at a time (stack semantics from §2).
- **Warning icon** (e.g. small triangle), **always visible** (not hover-gated) on
  any step that is in `forcedSteps` and fails `signalVerified`. `title`/`aria-label`
  tooltip: "Marked complete manually — automatic check for this step has not
  passed." Reuses the existing tooltip portal pattern already in `StepButton`
  (`spec-workflow-stepper.tsx:77-94`) rather than a second tooltip system.

`SpecWorkflowStepperProps` gains:

```ts
readonly forcedSteps?: readonly WorkflowStep[];
readonly onForceStep?: (step: WorkflowStep) => void;
readonly onUnforceStep?: (step: WorkflowStep) => void;
```

`spec-widget.tsx` wires these the same way it wires `onStepClick`/`onTaskToggle`
today (`spec-widget.tsx:263-269`, `:351`): new handlers dispatch new commands.

### 4. Commands & persistence — `spexr-commands-contribution.ts`

Two new commands, `SPEC_FORCE_STEP` / `SPEC_UNFORCE_STEP`, registered next to
`SPEC_TOGGLE_TASK` (`:148-151`, `:363-366`). Handlers mirror `runWorkflowStep`'s
setup (`:375-398`): read the spec file, compute signals via
`loadWorkflowSignals`, call `forceCompleteStep`/`unforceStep`, and on `ok: false`
call `this.messages.warn(result.error)` (same channel `warnDependency` already
uses) instead of proceeding. On success, write `forcedSteps` into frontmatter via
`patchFrontmatter()` — same helper `persistStep` already uses
(`spexr-commands-contribution.ts:488-504`) — no new file, no new I/O primitive.

## Testing

- `packages/spec/src/workflow.test.ts` (or wherever `resolveCurrentStep`/
  `computeProgress` are currently tested): unit tests for `forceCompleteStep`,
  `unforceStep`, `effectiveCurrentStep` — force-then-natural-catches-up,
  force-blocked-when-not-current, unforce-blocked-when-not-last,
  unforce-then-state-reverts.
- `spec-workflow-stepper` component test (if one exists) or a new one: force icon
  only rendered for `current`, undo icon only for the last-forced step, warning
  icon visibility tied to `signalVerified`.

## Acceptance criteria

- **AC-1**: Hovering the current step shows a force-complete icon; clicking it
  marks the step done and advances the stepper, persisted in the spec's
  frontmatter `forcedSteps`.
- **AC-2**: Attempting to force a step whose predecessor is not done (natural or
  forced) is rejected with a warning message; no frontmatter write happens.
- **AC-3**: Hovering the most-recently-forced step shows an undo icon; clicking it
  removes that step from `forcedSteps` and the stepper reverts to the
  natural/previous state.
- **AC-4**: A forced step whose real auto-completion signal still hasn't fired
  shows an always-visible warning icon with an explanatory tooltip; once the
  signal fires on its own, the warning disappears without any user action.
- **AC-5**: Reopening the spec (fresh read of the file) preserves forced state —
  `forcedSteps` round-trips through frontmatter parse/serialize.
