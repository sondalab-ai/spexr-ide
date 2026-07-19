# Force-Complete on Workflow Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user manually force the current spec-workflow step complete when its auto-completion signal hasn't fired, with dependency gating, undo, and a warning when the real signal still disagrees.

**Architecture:** A new `forcedSteps: WorkflowStep[]` field on `SpecFrontmatter`, persisted in the spec's own YAML frontmatter. Two new pure functions in `packages/spec` (`forceCompleteStep`, `unforceStep`) gate and mutate that list; a third (`effectiveCurrentStep`) blends it with the existing signal-only `resolveCurrentStep`. Two new Theia commands read/write the frontmatter through the existing `patchFrontmatter` helper. The stepper UI gets two hover-only overlay icons (force / undo) and one always-visible warning icon.

**Tech Stack:** TypeScript, vitest (packages/spec unit tests), React (Theia webview UI, no component test harness in this package — verified manually), Theia command/DI wiring.

## Global Constraints

- `packages/spec` is browser-safe: no Node built-ins (per `frontmatter.ts` header comment). New code must not add any.
- All new/changed exports flow through `packages/spec/src/index.ts`'s existing `export * from "./workflow.js"` — no index.ts edit needed unless a new file is added (none is).
- Match existing code style: no comments except non-obvious *why*, `readonly` on interface fields, named exports, no default exports.
- Spec doc of record: `docs/superpowers/specs/2026-07-12-workflow-step-force-complete-design.md`.

---

### Task 1: Persist `forcedSteps` in spec frontmatter

**Files:**
- Modify: `packages/spec/src/types.ts:34-43` (`SpecFrontmatter`)
- Modify: `packages/spec/src/parser.ts:46-71` (`readFrontmatter`)
- Modify: `packages/spec/src/writer.ts:4-27` (`FrontmatterPatch`, `patchFrontmatter`)
- Create: `packages/spec/src/parser.test.ts`
- Modify: `packages/spec/src/writer.test.ts`

**Interfaces:**
- Produces: `SpecFrontmatter.forcedSteps?: readonly WorkflowStep[]`; `FrontmatterPatch.forcedSteps?: readonly WorkflowStep[] | null` (null removes the key, matching the existing `workflowStep: null` convention at `writer.ts:20-22`); `parseSpec(raw, path).frontmatter.forcedSteps` populated from YAML array `forcedSteps: [plan, implement]`.
- Consumes: `WORKFLOW_STEP_ORDER`, `WorkflowStep` from `./types.js` (already imported in both files).

- [ ] **Step 1: Write failing parser test**

Create `packages/spec/src/parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSpec } from "./parser.js";

const BASE = `---
slug: 0010-sample
title: Sample spec
status: draft
---

## Goal

Body.
`;

describe("parseSpec frontmatter.forcedSteps", () => {
  it("is undefined when absent", () => {
    const spec = parseSpec(BASE, "/tmp/0010-sample.md");
    expect(spec.frontmatter.forcedSteps).toBeUndefined();
  });

  it("parses a valid forcedSteps array", () => {
    const raw = BASE.replace("status: draft", "status: draft\nforcedSteps: [specify, context]");
    const spec = parseSpec(raw, "/tmp/0010-sample.md");
    expect(spec.frontmatter.forcedSteps).toEqual(["specify", "context"]);
  });

  it("drops unknown step names", () => {
    const raw = BASE.replace("status: draft", "status: draft\nforcedSteps: [specify, bogus]");
    const spec = parseSpec(raw, "/tmp/0010-sample.md");
    expect(spec.frontmatter.forcedSteps).toEqual(["specify"]);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd packages/spec && pnpm vitest run src/parser.test.ts`
Expected: FAIL — `forcedSteps` is `undefined` in the second/third assertions (field doesn't exist yet).

- [ ] **Step 3: Add `forcedSteps` to `SpecFrontmatter`**

In `packages/spec/src/types.ts`, extend the interface at line 34-43:

```ts
export interface SpecFrontmatter {
  readonly slug: string;
  readonly title: string;
  readonly owner?: string;
  readonly status: SpecStatus;
  readonly workflowStep?: WorkflowStep;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly relatedSpecs?: readonly string[];
  readonly forcedSteps?: readonly WorkflowStep[];
}
```

- [ ] **Step 4: Parse `forcedSteps` in `readFrontmatter`**

In `packages/spec/src/parser.ts`, add to the return object in `readFrontmatter` (after the existing `relatedSpecs` spread at line 67-69):

```ts
    ...(Array.isArray(data.relatedSpecs)
      ? { relatedSpecs: data.relatedSpecs.filter((v): v is string => typeof v === "string") }
      : {}),
    ...(Array.isArray(data.forcedSteps)
      ? {
          forcedSteps: data.forcedSteps.filter(
            (v): v is WorkflowStep => typeof v === "string" && VALID_WORKFLOW_STEPS.has(v as WorkflowStep),
          ),
        }
      : {}),
```

- [ ] **Step 5: Run parser test again, confirm it passes**

Run: `cd packages/spec && pnpm vitest run src/parser.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write failing writer test**

In `packages/spec/src/writer.test.ts`, add (matching the existing `describe("patchFrontmatter", ...)` block's style):

```ts
  it("adds forcedSteps as an array", () => {
    const next = patchFrontmatter(SAMPLE, { forcedSteps: ["specify", "context"] });
    expect(next).toMatch(/forcedSteps: \[specify, context\]/);
  });

  it("removes forcedSteps when null", () => {
    const withForced = patchFrontmatter(SAMPLE, { forcedSteps: ["plan"] });
    const removed = patchFrontmatter(withForced, { forcedSteps: null });
    expect(removed).not.toMatch(/forcedSteps:/);
  });
```

- [ ] **Step 7: Run it, confirm it fails**

Run: `cd packages/spec && pnpm vitest run src/writer.test.ts`
Expected: FAIL — `FrontmatterPatch` has no `forcedSteps` property (TS) / value not written.

- [ ] **Step 8: Extend `FrontmatterPatch` and `patchFrontmatter`**

In `packages/spec/src/writer.ts`, extend the interface (line 4-8) and add handling in `patchFrontmatter` (after the `workflowStep` block, line 20-24):

```ts
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import type { SpecStatus, WorkflowStep } from "./types.js";

export interface FrontmatterPatch {
  readonly status?: SpecStatus;
  readonly workflowStep?: WorkflowStep | null;
  readonly forcedSteps?: readonly WorkflowStep[] | null;
  readonly updatedAt?: string;
}

export function patchFrontmatter(raw: string, patch: FrontmatterPatch): string {
  const parsed = parseFrontmatter(raw);
  const data: Record<string, unknown> = { ...parsed.data };

  if (patch.status !== undefined) data.status = patch.status;
  if (patch.workflowStep === null) {
    delete data.workflowStep;
  } else if (patch.workflowStep !== undefined) {
    data.workflowStep = patch.workflowStep;
  }
  if (patch.forcedSteps === null) {
    delete data.forcedSteps;
  } else if (patch.forcedSteps !== undefined) {
    data.forcedSteps = patch.forcedSteps;
  }
  if (patch.updatedAt !== undefined) data.updatedAt = patch.updatedAt;

  return stringifyFrontmatter(parsed.content, data);
}
```

- [ ] **Step 9: Run writer test again, confirm it passes**

Run: `cd packages/spec && pnpm vitest run src/writer.test.ts`
Expected: PASS (all tests in the file, including the 2 new ones).

- [ ] **Step 10: Typecheck the package**

Run: `cd packages/spec && pnpm typecheck`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add packages/spec/src/types.ts packages/spec/src/parser.ts packages/spec/src/writer.ts packages/spec/src/parser.test.ts packages/spec/src/writer.test.ts
git commit -m "feat(spec): persist forcedSteps in spec frontmatter"
```

---

### Task 2: Domain logic — force/unforce and effective progress

**Files:**
- Modify: `packages/spec/src/workflow.ts` (add after `persistedStateForStep`, end of file)
- Modify: `packages/spec/src/workflow.test.ts`

**Interfaces:**
- Consumes: `SpecFrontmatter`, `WorkflowStep`, `WORKFLOW_STEP_ORDER` from `./types.js` (already imported); `resolveCurrentStep`, `computeProgress`, `WorkflowSignals`, `WorkflowProgress`, `WORKFLOW_STEP_LABEL` (all already defined earlier in this same file, no new import needed).
- Produces (new exports from `workflow.ts`, re-exported via `index.ts`'s `export * from "./workflow.js"`):
  - `effectiveCurrentStep(frontmatter, signals): WorkflowStep | "done"`
  - `interface ForceStepResult { readonly ok: boolean; readonly forcedSteps: readonly WorkflowStep[]; readonly error?: string }`
  - `forceCompleteStep(frontmatter, signals, step): ForceStepResult`
  - `unforceStep(frontmatter, step): ForceStepResult`
  - `interface EffectiveWorkflowProgress extends WorkflowProgress { readonly forcedSteps: readonly WorkflowStep[]; readonly unverifiedForcedSteps: readonly WorkflowStep[] }`
  - `computeEffectiveProgress(frontmatter, signals): EffectiveWorkflowProgress`

- [ ] **Step 1: Write failing tests for `effectiveCurrentStep`**

Add to `packages/spec/src/workflow.test.ts`. First, extend the existing `import { computeProgress, hasAuthoredAcceptanceCriteria, resolveCurrentStep, WORKFLOW_STEP_EXPERT } from "./workflow.js";` (top of file) to also pull in the four new names:

```ts
import {
  computeEffectiveProgress,
  computeProgress,
  effectiveCurrentStep,
  forceCompleteStep,
  hasAuthoredAcceptanceCriteria,
  resolveCurrentStep,
  unforceStep,
  WORKFLOW_STEP_EXPERT,
} from "./workflow.js";
```

Then add these new `describe` blocks below the existing ones (following the file's style — see the `resolveCurrentStep` block at the top for the `WorkflowSignals` shape used):

```ts
describe("effectiveCurrentStep", () => {
  const SIGNALS_NONE = { hasAcceptanceCriteria: false, hasContext: false, hasClarifications: false };

  it("matches resolveCurrentStep when nothing is forced", () => {
    expect(
      effectiveCurrentStep({ status: "draft" }, SIGNALS_NONE),
    ).toBe("specify");
  });

  it("advances past a forced step", () => {
    expect(
      effectiveCurrentStep(
        { status: "draft", forcedSteps: ["specify"] },
        SIGNALS_NONE,
      ),
    ).toBe("context");
  });

  it("does not regress when natural signals are already ahead of the forced step", () => {
    expect(
      effectiveCurrentStep(
        { status: "draft", forcedSteps: ["specify"] },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true },
      ),
    ).toBe("plan");
  });

  it("returns done when forcing the last step", () => {
    expect(
      effectiveCurrentStep(
        { status: "validated", forcedSteps: ["specify", "context", "clarify", "plan", "implement", "validate", "ship"] },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true },
      ),
    ).toBe("done");
  });
});

describe("forceCompleteStep", () => {
  const SIGNALS_NONE = { hasAcceptanceCriteria: false, hasContext: false, hasClarifications: false };

  it("forces the current step", () => {
    const result = forceCompleteStep({ status: "draft" }, SIGNALS_NONE, "specify");
    expect(result).toEqual({ ok: true, forcedSteps: ["specify"] });
  });

  it("rejects forcing a step that is not current", () => {
    const result = forceCompleteStep({ status: "draft" }, SIGNALS_NONE, "plan");
    expect(result.ok).toBe(false);
    expect(result.forcedSteps).toEqual([]);
    expect(result.error).toMatch(/not the current step/);
  });

  it("rejects forcing when the spec is already done", () => {
    const result = forceCompleteStep({ status: "archived" }, SIGNALS_NONE, "ship");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already complete/);
  });
});

describe("unforceStep", () => {
  it("removes the last forced step", () => {
    const result = unforceStep({ forcedSteps: ["specify", "context"] }, "context");
    expect(result).toEqual({ ok: true, forcedSteps: ["specify"] });
  });

  it("rejects undoing a step that is not the last forced one", () => {
    const result = unforceStep({ forcedSteps: ["specify", "context"] }, "specify");
    expect(result.ok).toBe(false);
    expect(result.forcedSteps).toEqual(["specify", "context"]);
    expect(result.error).toMatch(/not the most recently forced/);
  });

  it("rejects undoing when nothing is forced", () => {
    const result = unforceStep({ forcedSteps: [] }, "specify");
    expect(result.ok).toBe(false);
  });
});

describe("computeEffectiveProgress", () => {
  it("flags a forced step whose signal has not fired as unverified", () => {
    const progress = computeEffectiveProgress(
      { status: "draft", forcedSteps: ["specify"] },
      { hasAcceptanceCriteria: false, hasContext: false, hasClarifications: false },
    );
    expect(progress.currentStep).toBe("context");
    expect(progress.forcedSteps).toEqual(["specify"]);
    expect(progress.unverifiedForcedSteps).toEqual(["specify"]);
  });

  it("does not flag a forced step once its own signal independently fires", () => {
    const progress = computeEffectiveProgress(
      { status: "draft", forcedSteps: ["specify"] },
      { hasAcceptanceCriteria: true, hasContext: false, hasClarifications: false },
    );
    expect(progress.unverifiedForcedSteps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd packages/spec && pnpm vitest run src/workflow.test.ts`
Expected: FAIL — `effectiveCurrentStep`, `forceCompleteStep`, `unforceStep`, `computeEffectiveProgress` are not exported yet.

- [ ] **Step 3: Implement the four functions**

Append to `packages/spec/src/workflow.ts` (after `persistedStateForStep`, end of file):

```ts
export function effectiveCurrentStep(
  frontmatter: Pick<SpecFrontmatter, "status" | "workflowStep" | "forcedSteps">,
  signals: WorkflowSignals,
): WorkflowStep | "done" {
  const natural = resolveCurrentStep(frontmatter, signals);
  const forced = frontmatter.forcedSteps ?? [];
  if (forced.length === 0) return natural;
  const forcedIdx = WORKFLOW_STEP_ORDER.indexOf(forced[forced.length - 1]!);
  const naturalIdx = natural === "done" ? WORKFLOW_STEP_ORDER.length : WORKFLOW_STEP_ORDER.indexOf(natural);
  const idx = Math.max(naturalIdx, forcedIdx + 1);
  return idx >= WORKFLOW_STEP_ORDER.length ? "done" : WORKFLOW_STEP_ORDER[idx]!;
}

export interface ForceStepResult {
  readonly ok: boolean;
  readonly forcedSteps: readonly WorkflowStep[];
  readonly error?: string;
}

/**
 * Force the current step complete regardless of its auto-completion signal.
 * Only the step `effectiveCurrentStep` currently reports as current can be
 * forced — this keeps `forcedSteps` a contiguous prefix of WORKFLOW_STEP_ORDER
 * by construction, so no separate predecessor check is needed.
 */
export function forceCompleteStep(
  frontmatter: Pick<SpecFrontmatter, "status" | "workflowStep" | "forcedSteps">,
  signals: WorkflowSignals,
  step: WorkflowStep,
): ForceStepResult {
  const forced = frontmatter.forcedSteps ?? [];
  const current = effectiveCurrentStep(frontmatter, signals);
  if (step !== current) {
    const label = WORKFLOW_STEP_LABEL[step];
    return {
      ok: false,
      forcedSteps: forced,
      error:
        current === "done"
          ? `Cannot force "${label}" — spec is already complete.`
          : `Cannot force "${label}" — it is not the current step.`,
    };
  }
  return { ok: true, forcedSteps: [...forced, step] };
}

/** Undo a force — only the most recently forced step can be undone (stack). */
export function unforceStep(
  frontmatter: Pick<SpecFrontmatter, "forcedSteps">,
  step: WorkflowStep,
): ForceStepResult {
  const forced = frontmatter.forcedSteps ?? [];
  const last = forced[forced.length - 1];
  if (last !== step) {
    return {
      ok: false,
      forcedSteps: forced,
      error: `Cannot undo "${WORKFLOW_STEP_LABEL[step]}" — it is not the most recently forced step.`,
    };
  }
  return { ok: true, forcedSteps: forced.slice(0, -1) };
}

export interface EffectiveWorkflowProgress extends WorkflowProgress {
  readonly forcedSteps: readonly WorkflowStep[];
  /** Forced steps whose own auto-completion signal still hasn't fired — drives the stepper's warning icon. */
  readonly unverifiedForcedSteps: readonly WorkflowStep[];
}

export function computeEffectiveProgress(
  frontmatter: Pick<SpecFrontmatter, "status" | "workflowStep" | "forcedSteps">,
  signals: WorkflowSignals,
): EffectiveWorkflowProgress {
  const natural = resolveCurrentStep(frontmatter, signals);
  const naturalIdx = natural === "done" ? WORKFLOW_STEP_ORDER.length : WORKFLOW_STEP_ORDER.indexOf(natural);
  const forcedSteps = frontmatter.forcedSteps ?? [];
  const progress = computeProgress(effectiveCurrentStep(frontmatter, signals));
  const unverifiedForcedSteps = forcedSteps.filter(
    (step) => naturalIdx <= WORKFLOW_STEP_ORDER.indexOf(step),
  );
  return { ...progress, forcedSteps, unverifiedForcedSteps };
}
```

- [ ] **Step 4: Run tests again, confirm they pass**

Run: `cd packages/spec && pnpm vitest run src/workflow.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/spec && pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/spec/src/workflow.ts packages/spec/src/workflow.test.ts
git commit -m "feat(spec): add forceCompleteStep/unforceStep and computeEffectiveProgress"
```

---

### Task 3: Force/unforce commands

**Files:**
- Modify: `packages/theia-extensions/src/browser/commands/spexr-commands-contribution.ts`

**Interfaces:**
- Consumes: `forceCompleteStep`, `unforceStep as unforceWorkflowStep`, `hasAuthoredAcceptanceCriteria`, `parseSpec`, `patchFrontmatter`, `WorkflowStep` from `@spexr/spec` (extend the existing import block); `this.loadWorkflowSignals(uri, slug)` (existing private method, `spexr-commands-contribution.ts:452-463`); `this.resolveSpecUri`, `this.coerceWorkflowStep` (existing private methods); `this.messages.warn` / `.error` (existing `MessageService`, used throughout this file, e.g. `warnDependency` at line 436-450).
- Produces: `SpexrCommands.SPEC_FORCE_STEP`, `SpexrCommands.SPEC_UNFORCE_STEP` (command ids `spexr.spec.forceStep` / `spexr.spec.unforceStep`), consumed by Task 4's widget handlers.

- [ ] **Step 1: Extend the `@spexr/spec` import**

Find the import block that currently includes `patchFrontmatter`, `hasAuthoredAcceptanceCriteria`, `resolveCurrentStep`, `computeProgress` (near the top of `spexr-commands-contribution.ts`) and add:

```ts
  forceCompleteStep,
  unforceStep as unforceWorkflowStep,
```

(Aliased to avoid colliding with the new private method `unforceStep` added in Step 4 below.)

- [ ] **Step 2: Add the two new commands to `SpexrCommands`**

In the `SpexrCommands` const object (`spexr-commands-contribution.ts:45-...`), add after `SPEC_TOGGLE_TASK` (line 148-151):

```ts
  SPEC_FORCE_STEP: {
    id: "spexr.spec.forceStep",
    label: "Spexr: Force-complete workflow step",
  } satisfies Command,
  SPEC_UNFORCE_STEP: {
    id: "spexr.spec.unforceStep",
    label: "Spexr: Undo forced workflow step",
  } satisfies Command,
```

- [ ] **Step 3: Register the commands**

In the registration block, after the `SPEC_TOGGLE_TASK` registration (line 363-366):

```ts
    commands.registerCommand(SpexrCommands.SPEC_FORCE_STEP, {
      execute: (rawUri: unknown, rawStep: unknown) =>
        this.forceStep(this.resolveSpecUri(rawUri), this.coerceWorkflowStep(rawStep)),
    });
    commands.registerCommand(SpexrCommands.SPEC_UNFORCE_STEP, {
      execute: (rawUri: unknown, rawStep: unknown) =>
        this.unforceStep(this.resolveSpecUri(rawUri), this.coerceWorkflowStep(rawStep)),
    });
```

- [ ] **Step 4: Add the three private methods**

Add next to `togglePlanTask` (`spexr-commands-contribution.ts:605-620`):

```ts
  private async forceStep(uri: URI | undefined, step: WorkflowStep | undefined): Promise<void> {
    if (!uri || !step) return;
    try {
      const file = await this.fileService.read(uri);
      const spec = parseSpec(file.value, uri.toString());
      const fsSignals = await this.loadWorkflowSignals(uri, spec.frontmatter.slug);
      const signals = {
        ...fsSignals,
        hasAcceptanceCriteria: hasAuthoredAcceptanceCriteria(spec.acceptanceCriteria),
      };
      const result = forceCompleteStep(spec.frontmatter, signals, step);
      if (!result.ok) {
        this.messages.warn(result.error!);
        return;
      }
      await this.persistForcedSteps(uri, result.forcedSteps);
    } catch (err) {
      this.messages.error(`Failed to force step: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async unforceStep(uri: URI | undefined, step: WorkflowStep | undefined): Promise<void> {
    if (!uri || !step) return;
    try {
      const file = await this.fileService.read(uri);
      const spec = parseSpec(file.value, uri.toString());
      const result = unforceWorkflowStep(spec.frontmatter, step);
      if (!result.ok) {
        this.messages.warn(result.error!);
        return;
      }
      await this.persistForcedSteps(uri, result.forcedSteps);
    } catch (err) {
      this.messages.error(`Failed to undo forced step: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async persistForcedSteps(uri: URI, forcedSteps: readonly WorkflowStep[]): Promise<void> {
    const current = await this.fileService.read(uri);
    const today = new Date().toISOString().slice(0, 10);
    const next = patchFrontmatter(current.value, {
      forcedSteps: forcedSteps.length > 0 ? forcedSteps : null,
      updatedAt: today,
    });
    if (next !== current.value) {
      await this.fileService.write(uri, next);
    }
  }
```

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/theia-extensions && pnpm typecheck`
Expected: no errors. (No test file changes in this task — this package has no command-layer unit tests today; correctness is exercised through Task 6's manual pass.)

- [ ] **Step 6: Commit**

```bash
git add packages/theia-extensions/src/browser/commands/spexr-commands-contribution.ts
git commit -m "feat(theia-extensions): add force/unforce workflow-step commands"
```

---

### Task 4: Wire force/unforce into the spec widget

**Files:**
- Modify: `packages/theia-extensions/src/browser/views/spec-widget.tsx`

**Interfaces:**
- Consumes: `computeEffectiveProgress`, `type EffectiveWorkflowProgress` from `@spexr/spec` (replaces `computeProgress`/`resolveCurrentStep` calls in `buildEntry`); `SpexrCommands.SPEC_FORCE_STEP`, `SpexrCommands.SPEC_UNFORCE_STEP` from Task 3.
- Produces: `SpecPanelProps.onForceStep`, `SpecPanelProps.onUnforceStep` (new props, consumed by Task 5's `SpecWorkflowStepper`); `SpecEntry.progress` type changes from `WorkflowProgress` to `EffectiveWorkflowProgress`.

- [ ] **Step 1: Swap the import**

In the `@spexr/spec` import block at the top of `spec-widget.tsx` (`spec-widget.tsx:9-19`, currently importing `computeProgress`, `resolveCurrentStep`, and `type WorkflowProgress` among others), remove those three names and add:

```ts
  computeEffectiveProgress,
  type EffectiveWorkflowProgress,
```

`type WorkflowProgress` is dropped because, after Step 2 below, nothing in this file references it directly anymore (`EffectiveWorkflowProgress` extends it but callers only need the extended name) — leaving it in would fail typecheck under `noUnusedLocals`. Keep `hasAuthoredAcceptanceCriteria`, `parseSpec`, `parseSpecPlan`, `WORKFLOW_STEP_ORDER`, and the other existing type imports (`DriftReport`, `PlanTask`, `WorkflowStep`) unchanged.

- [ ] **Step 2: Update `SpecEntry` and `SpecPanelProps`**

Change `SpecEntry.progress` type (currently `readonly progress: WorkflowProgress;`) to:

```ts
  readonly progress: EffectiveWorkflowProgress;
```

Add two props to `SpecPanelProps` (next to `onTaskToggle`):

```ts
  readonly onForceStep: (uri: string, step: WorkflowStep) => void;
  readonly onUnforceStep: (uri: string, step: WorkflowStep) => void;
```

- [ ] **Step 3: Update `buildEntry` to use `computeEffectiveProgress`**

Replace lines 168-181 (the `resolveCurrentStep(...)` call through the success-path `return`) with:

```ts
      const signals = {
        hasAcceptanceCriteria: hasAuthoredAcceptanceCriteria(spec.acceptanceCriteria),
        hasContext,
        hasClarifications,
        hasPlan,
        ...(driftReport ? { driftReport } : {}),
      };
      return {
        uri: uri.toString(),
        name: filename,
        title: spec.frontmatter.title || filename,
        progress: computeEffectiveProgress(spec.frontmatter, signals),
        planTasks,
      };
```

And update the catch-path fallback (currently `progress: computeProgress("specify")`, line 187) to:

```ts
        progress: computeEffectiveProgress({ status: "draft" }, {
          hasAcceptanceCriteria: false,
          hasContext: false,
          hasClarifications: false,
        }),
```

- [ ] **Step 4: Add the two handlers on `SpexrSpecWidget`**

Next to `handleTaskToggle` (`spec-widget.tsx:267-269`):

```ts
  private readonly handleForceStep = (uri: string, step: WorkflowStep): void => {
    void this.commands.executeCommand(SpexrCommands.SPEC_FORCE_STEP.id, uri, step);
  };

  private readonly handleUnforceStep = (uri: string, step: WorkflowStep): void => {
    void this.commands.executeCommand(SpexrCommands.SPEC_UNFORCE_STEP.id, uri, step);
  };
```

And pass them into `<SpecPanel>` in `render()` (next to `onTaskToggle={this.handleTaskToggle}`):

```tsx
        onForceStep={this.handleForceStep}
        onUnforceStep={this.handleUnforceStep}
```

- [ ] **Step 5: Thread the props through `SpecPanel` to `SpecWorkflowStepper`**

In the `SpecPanel` functional component's destructured props, add `onForceStep, onUnforceStep`. In the `<SpecWorkflowStepper>` call (`spec-widget.tsx:349-354`), add:

```tsx
                forcedSteps={spec.progress.forcedSteps}
                unverifiedForcedSteps={spec.progress.unverifiedForcedSteps}
                onForceStep={(step) => onForceStep(spec.uri, step)}
                onUnforceStep={(step) => onUnforceStep(spec.uri, step)}
```

- [ ] **Step 6: Typecheck**

Run: `cd packages/theia-extensions && pnpm typecheck`
Expected: errors referencing `SpecWorkflowStepperProps` missing `forcedSteps`/`unverifiedForcedSteps`/`onForceStep`/`onUnforceStep` — expected until Task 5 adds them. Confirm no *other* errors (i.e. everything in this task's own files is otherwise correctly typed against the Task 2/3 exports).

- [ ] **Step 7: Commit**

```bash
git add packages/theia-extensions/src/browser/views/spec-widget.tsx
git commit -m "feat(theia-extensions): wire force/unforce handlers into spec widget"
```

---

### Task 5: Stepper UI — force / undo / warning icons

**Files:**
- Modify: `packages/theia-extensions/src/browser/views/spec-workflow-stepper.tsx`
- Modify: `packages/theia-extensions/src/browser/style/spexr.css`

**Interfaces:**
- Consumes: `EffectiveWorkflowProgress` fields `forcedSteps`/`unverifiedForcedSteps` (Task 2); `onForceStep`/`onUnforceStep` props threaded in from Task 4.
- Produces: fully working UI; no further consumers.

- [ ] **Step 1: Extend `SpecWorkflowStepperProps` and `StepButton` props**

In `spec-workflow-stepper.tsx`, extend `SpecWorkflowStepperProps` (line 13-19):

```ts
export interface SpecWorkflowStepperProps {
  readonly progress: WorkflowProgress;
  readonly onStepClick: (step: WorkflowStep) => void;
  readonly busy?: boolean;
  readonly planTasks?: readonly PlanTask[];
  readonly onTaskToggle?: (taskId: string) => void;
  readonly forcedSteps?: readonly WorkflowStep[];
  readonly unverifiedForcedSteps?: readonly WorkflowStep[];
  readonly onForceStep?: (step: WorkflowStep) => void;
  readonly onUnforceStep?: (step: WorkflowStep) => void;
}
```

Extend the `StepButton` prop type (line 30-36) and destructuring (line 36):

```ts
const StepButton: React.FC<{
  readonly step: WorkflowStep;
  readonly index: number;
  readonly state: WorkflowProgress["stateByStep"][WorkflowStep];
  readonly busy: boolean;
  readonly onStepClick: (step: WorkflowStep) => void;
  readonly isLastForced: boolean;
  readonly isUnverified: boolean;
  readonly onForceStep?: (step: WorkflowStep) => void;
  readonly onUnforceStep?: (step: WorkflowStep) => void;
}> = ({ step, index, state, busy, onStepClick, isLastForced, isUnverified, onForceStep, onUnforceStep }) => {
```

- [ ] **Step 2: Add the overlay icons inside `StepButton`'s `<li>`**

In `spec-workflow-stepper.tsx`, the `StepButton` currently returns a `<li>` containing the `<button>` and the portal tooltip (lines 57-96). Add two overlay buttons and a warning badge as siblings of the main `<button>`, inside the same `<li>`:

```tsx
      {state === "current" && onForceStep ? (
        <button
          type="button"
          className="spexr-stepper__overlay spexr-stepper__overlay--force"
          onClick={(e) => {
            e.stopPropagation();
            onForceStep(step);
          }}
          title="Force this step complete"
          aria-label={`Force ${label} complete`}
        >
          ✔
        </button>
      ) : null}
      {isLastForced && onUnforceStep ? (
        <button
          type="button"
          className="spexr-stepper__overlay spexr-stepper__overlay--undo"
          onClick={(e) => {
            e.stopPropagation();
            onUnforceStep(step);
          }}
          title="Undo forced completion"
          aria-label={`Undo forced completion of ${label}`}
        >
          ↺
        </button>
      ) : null}
      {isUnverified ? (
        <span
          className="spexr-stepper__warning"
          title="Marked complete manually — automatic check for this step has not passed."
          aria-label={`${label} was marked complete manually and has not passed its automatic check`}
        >
          ⚠
        </span>
      ) : null}
```

Place this block right after the closing `</button>` of the main step button and before the `{pos ? createPortal(...) : null}` tooltip block, so it renders inside `<li className="spexr-stepper__item ...">`.

- [ ] **Step 3: Compute `isLastForced`/`isUnverified` and pass them from `SpecWorkflowStepper`**

Replace the `SpecWorkflowStepper` component body's `.map` (lines 108-117) with:

```tsx
      {WORKFLOW_STEP_ORDER.map((step, index) => {
        const forced = forcedSteps ?? [];
        const isLastForced = forced.length > 0 && forced[forced.length - 1] === step;
        const isUnverified = (unverifiedForcedSteps ?? []).includes(step);
        return (
          <StepButton
            key={step}
            step={step}
            index={index}
            state={progress.stateByStep[step]}
            busy={busy}
            onStepClick={onStepClick}
            isLastForced={isLastForced}
            isUnverified={isUnverified}
            {...(onForceStep ? { onForceStep } : {})}
            {...(onUnforceStep ? { onUnforceStep } : {})}
          />
        );
      })}
```

And destructure the two new array props plus `onForceStep`/`onUnforceStep` in `SpecWorkflowStepper`'s own prop list (line 99-104):

```tsx
export const SpecWorkflowStepper: React.FC<SpecWorkflowStepperProps> = ({
  progress,
  onStepClick,
  busy = false,
  planTasks,
  onTaskToggle,
  forcedSteps,
  unverifiedForcedSteps,
  onForceStep,
  onUnforceStep,
}) => (
```

- [ ] **Step 4: Add CSS for the overlay icons and warning badge**

In `packages/theia-extensions/src/browser/style/spexr.css`, after the `.spexr-stepper__item` rule (line 1278-1294), add:

```css
.spexr-stepper__overlay {
  position: absolute;
  top: -6px;
  display: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--spexr-border-default);
  background: var(--spexr-bg-surface-raised);
  color: var(--spexr-text-primary);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  z-index: 1;
}

.spexr-stepper__item:hover .spexr-stepper__overlay {
  display: inline-flex;
}

.spexr-stepper__overlay--force {
  right: -6px;
  border-color: var(--spexr-accent-default);
  color: var(--spexr-accent-default);
}

.spexr-stepper__overlay--undo {
  left: -6px;
}

.spexr-stepper__warning {
  position: absolute;
  top: -6px;
  right: -6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 10px;
  color: var(--spexr-color-warning, #d9822b);
}
```

- [ ] **Step 5: Typecheck**

Run: `cd packages/theia-extensions && pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Lint**

Run: `cd packages/theia-extensions && pnpm lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/theia-extensions/src/browser/views/spec-workflow-stepper.tsx packages/theia-extensions/src/browser/style/spexr.css
git commit -m "feat(theia-extensions): add force/undo/warning icons to workflow stepper"
```

---

### Task 6: Manual verification in the running app

No component-test harness exists for this package's React views (verified: no `*.test.tsx` files, no `@testing-library/react` dependency) — this feature's UI layer is verified by driving the real app, per project convention.

**Files:** none (verification only).

- [ ] **Step 1: Build and launch**

Use the project's own `run` skill/procedure (or `pnpm --filter @spexr/theia-extensions build` then the app's existing dev-launch command) to open the Electron app on a workspace containing at least one `docs/specs/*.md` file in `draft` status with no acceptance criteria authored yet.

- [ ] **Step 2: Verify force on the current step**

Hover the `specify` step (should be `current`, no real AC authored). Confirm a check-mark overlay icon appears only on hover. Click it. Confirm: stepper advances to `context`, an always-visible warning icon (⚠) now sits on the `specify` step, and hovering `specify` now shows an undo icon instead of the force icon.

- [ ] **Step 3: Verify the warning clears when the real signal fires**

Author a real (non-placeholder) acceptance criterion in the spec and save. Confirm the warning icon on `specify` disappears once the widget refreshes (no manual action needed) — this exercises `unverifiedForcedSteps` recomputing via `naturalIdx` catching up.

- [ ] **Step 4: Verify undo**

With a step still forced and its undo icon showing, click undo. Confirm the stepper reverts to the state it would show without the force (matching what `resolveCurrentStep` alone would compute).

- [ ] **Step 5: Verify the dependency guard**

Attempt to force a step that is not current (this requires a second spec or a stale UI state — alternatively, invoke `spexr.spec.forceStep` via the command palette with an explicit non-current step argument if the UI doesn't otherwise expose one). Confirm a warning toast appears (`Cannot force "<Step>" — it is not the current step.`) and the spec's frontmatter is unchanged.

- [ ] **Step 6: Verify persistence**

Reload the window (or reopen the workspace). Confirm forced/undone state survived — read the spec's `.md` file directly and confirm `forcedSteps:` in the frontmatter matches what the UI shows.

- [ ] **Step 7: Run the full test suite once more**

Run: `cd /Users/marcello.barile/src/mine/spexr && pnpm test`
Expected: all packages pass, including the new `packages/spec` tests from Tasks 1-2.
