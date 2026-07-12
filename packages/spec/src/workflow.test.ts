import { describe, expect, it } from "vitest";
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
import type { AcceptanceCriterion } from "./types.js";
import type { DriftReport } from "./types.js";
import { WORKFLOW_STEP_ORDER } from "./types.js";

describe("resolveCurrentStep", () => {
  it("returns done for archived spec", () => {
    expect(
      resolveCurrentStep(
        { status: "archived" },
        { hasAcceptanceCriteria: true, hasContext: false, hasClarifications: false },
      ),
    ).toBe("done");
  });

  it("honours explicit workflowStep over derivation", () => {
    expect(
      resolveCurrentStep(
        { status: "draft", workflowStep: "plan" },
        { hasAcceptanceCriteria: true, hasContext: false, hasClarifications: false },
      ),
    ).toBe("plan");
  });

  // A persisted workflowStep must not let a draft skip specify when no real
  // acceptance criteria exist (e.g. a spec saved by a looser earlier build).
  it("clamps to specify when draft has a workflowStep but no acceptance criteria", () => {
    expect(
      resolveCurrentStep(
        { status: "draft", workflowStep: "context" },
        { hasAcceptanceCriteria: false, hasContext: true, hasClarifications: false },
      ),
    ).toBe("specify");
  });

  it("derives context when AC authored but no context yet", () => {
    expect(
      resolveCurrentStep(
        { status: "draft" },
        { hasAcceptanceCriteria: true, hasContext: false, hasClarifications: false },
      ),
    ).toBe("context");
  });

  // Regression: a fresh draft (no acceptance criteria yet) must keep "specify"
  // as the current step, not silently mark it done. The fs signal advances to
  // "context" only once real AC bullets exist.
  it("keeps specify current and context pending for a fresh draft", () => {
    const progress = computeProgress(
      resolveCurrentStep(
        { status: "draft" },
        { hasAcceptanceCriteria: false, hasContext: false, hasClarifications: false },
      ),
    );
    expect(progress.stateByStep.specify).toBe("current");
    expect(progress.stateByStep.context).toBe("pending");
  });

  it("advances specify to done once acceptance criteria are authored", () => {
    const progress = computeProgress(
      resolveCurrentStep(
        { status: "draft" },
        { hasAcceptanceCriteria: true, hasContext: false, hasClarifications: false },
      ),
    );
    expect(progress.stateByStep.specify).toBe("done");
    expect(progress.stateByStep.context).toBe("current");
  });

  it("derives clarify when context exists but no clarifications", () => {
    expect(
      resolveCurrentStep(
        { status: "draft" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: false },
      ),
    ).toBe("clarify");
  });

  it("derives plan when context + clarifications present", () => {
    expect(
      resolveCurrentStep(
        { status: "draft" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true },
      ),
    ).toBe("plan");
  });

  it("maps in-progress status to implement", () => {
    expect(
      resolveCurrentStep(
        { status: "in-progress" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true },
      ),
    ).toBe("implement");
  });

  it("maps implemented status to validate without drift report", () => {
    expect(
      resolveCurrentStep(
        { status: "implemented" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true },
      ),
    ).toBe("validate");
  });

  it("stays in validate when drift has block findings", () => {
    const driftReport: DriftReport = {
      specSlug: "0001-x",
      checkedAt: new Date().toISOString(),
      findings: [{ criterionId: "AC-1", severity: "block", message: "missing test" }],
    };
    expect(
      resolveCurrentStep(
        { status: "implemented" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true, driftReport },
      ),
    ).toBe("validate");
  });

  it("advances to ship when implemented and drift is clean", () => {
    const driftReport: DriftReport = {
      specSlug: "0001-x",
      checkedAt: new Date().toISOString(),
      findings: [],
    };
    expect(
      resolveCurrentStep(
        { status: "implemented" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true, driftReport },
      ),
    ).toBe("ship");
  });

  it("maps validated to ship", () => {
    expect(
      resolveCurrentStep(
        { status: "validated" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true },
      ),
    ).toBe("ship");
  });

  it("returns done for shipped spec", () => {
    expect(
      resolveCurrentStep(
        { status: "shipped" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true },
      ),
    ).toBe("done");
  });
});

describe("hasAuthoredAcceptanceCriteria", () => {
  const ac = (text: string): AcceptanceCriterion => ({ id: "AC-1", text });

  it("ignores the empty scaffold stub", () => {
    expect(hasAuthoredAcceptanceCriteria([ac("**AC-1**")])).toBe(false);
  });

  it("ignores blank text", () => {
    expect(hasAuthoredAcceptanceCriteria([ac("   ")])).toBe(false);
  });

  it("returns false for no criteria", () => {
    expect(hasAuthoredAcceptanceCriteria([])).toBe(false);
  });

  it("returns true once a criterion has a real description", () => {
    expect(hasAuthoredAcceptanceCriteria([ac("The user can log in")])).toBe(true);
  });
});

describe("computeProgress", () => {
  it("returns 0 for first step", () => {
    const progress = computeProgress("specify");
    expect(progress.percent).toBe(0);
    expect(progress.doneCount).toBe(0);
    expect(progress.stateByStep.specify).toBe("current");
    expect(progress.stateByStep.ship).toBe("pending");
  });

  it("marks earlier steps done", () => {
    const progress = computeProgress("implement");
    expect(progress.stateByStep.specify).toBe("done");
    expect(progress.stateByStep.plan).toBe("done");
    expect(progress.stateByStep.implement).toBe("current");
    expect(progress.stateByStep.validate).toBe("pending");
  });

  it("returns 100% when done", () => {
    const progress = computeProgress("done");
    expect(progress.percent).toBe(100);
    expect(progress.doneCount).toBe(progress.totalCount);
    expect(progress.stateByStep.ship).toBe("done");
  });
});

describe("WORKFLOW_STEP_EXPERT", () => {
  it("maps every workflow step", () => {
    for (const step of WORKFLOW_STEP_ORDER) {
      expect(step in WORKFLOW_STEP_EXPERT).toBe(true);
    }
  });

  it("maps implement to the software-engineering expert", () => {
    expect(WORKFLOW_STEP_EXPERT.implement).toBe("software-engineering");
  });
});

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

describe("forceCompleteStep + unforceStep sequences (built via the real API, not hand-constructed frontmatter)", () => {
  const SIGNALS_NONE = { hasAcceptanceCriteria: false, hasContext: false, hasClarifications: false };

  it("builds forcedSteps as a chain by repeated forceCompleteStep calls", () => {
    const r1 = forceCompleteStep({ status: "draft" }, SIGNALS_NONE, "specify");
    expect(r1).toEqual({ ok: true, forcedSteps: ["specify"] });

    const r2 = forceCompleteStep({ status: "draft", forcedSteps: r1.forcedSteps }, SIGNALS_NONE, "context");
    expect(r2).toEqual({ ok: true, forcedSteps: ["specify", "context"] });

    const r3 = forceCompleteStep({ status: "draft", forcedSteps: r2.forcedSteps }, SIGNALS_NONE, "clarify");
    expect(r3).toEqual({ ok: true, forcedSteps: ["specify", "context", "clarify"] });

    expect(effectiveCurrentStep({ status: "draft", forcedSteps: r3.forcedSteps }, SIGNALS_NONE)).toBe("plan");
  });

  it("unwinds the chain in LIFO order via repeated unforceStep calls", () => {
    const u1 = unforceStep({ forcedSteps: ["specify", "context", "clarify"] }, "clarify");
    expect(u1).toEqual({ ok: true, forcedSteps: ["specify", "context"] });

    const blocked = unforceStep({ forcedSteps: u1.forcedSteps }, "specify");
    expect(blocked.ok).toBe(false);

    const u2 = unforceStep({ forcedSteps: u1.forcedSteps }, "context");
    expect(u2).toEqual({ ok: true, forcedSteps: ["specify"] });

    const u3 = unforceStep({ forcedSteps: u2.forcedSteps }, "specify");
    expect(u3).toEqual({ ok: true, forcedSteps: [] });
  });

  it("forces from wherever the natural signals already are, not necessarily from specify", () => {
    const signalsAhead = { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: false };
    expect(effectiveCurrentStep({ status: "draft" }, signalsAhead)).toBe("clarify");

    const result = forceCompleteStep({ status: "draft" }, signalsAhead, "clarify");
    expect(result).toEqual({ ok: true, forcedSteps: ["clarify"] });
    expect(effectiveCurrentStep({ status: "draft", forcedSteps: result.forcedSteps }, signalsAhead)).toBe("plan");
  });
});
