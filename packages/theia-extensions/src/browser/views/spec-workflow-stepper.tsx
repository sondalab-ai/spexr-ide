import * as React from "react";
import { createPortal } from "@theia/core/shared/react-dom";
import {
  WORKFLOW_STEP_HINT,
  WORKFLOW_STEP_LABEL,
  WORKFLOW_STEP_ORDER,
  WORKFLOW_STEP_PROMPT_PREVIEW,
  type PlanTask,
  type WorkflowProgress,
  type WorkflowStep,
} from "@spexr/spec";

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

const TOOLTIP_WIDTH = 260;
const TOOLTIP_GAP = 8;

interface TooltipPos {
  readonly top: number;
  readonly left: number;
  readonly placement: "above" | "below";
}

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
  const label = WORKFLOW_STEP_LABEL[step];
  const hint = WORKFLOW_STEP_HINT[step];
  const preview = WORKFLOW_STEP_PROMPT_PREVIEW[step];
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const [pos, setPos] = React.useState<TooltipPos | undefined>(undefined);

  const show = React.useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const above = rect.top - TOOLTIP_GAP;
    const placement = above > 160 ? "above" : "below";
    let left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - TOOLTIP_WIDTH - 8));
    const top = placement === "above" ? rect.top - TOOLTIP_GAP : rect.bottom + TOOLTIP_GAP;
    setPos({ top, left, placement });
  }, []);

  const hide = React.useCallback(() => setPos(undefined), []);

  return (
    <li className={`spexr-stepper__item spexr-stepper__item--${state}`}>
      <button
        ref={btnRef}
        type="button"
        className="spexr-stepper__btn"
        onClick={() => onStepClick(step)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        disabled={busy}
        aria-current={state === "current" ? "step" : undefined}
        aria-label={`${label} — ${hint}`}
      >
        <span className="spexr-stepper__num" aria-hidden>
          {state === "done" ? "✓" : String(index + 1)}
        </span>
        <span className="spexr-stepper__label">{label}</span>
      </button>
      {/* "ship" is excluded: spec-widget.tsx already treats currentStep === "ship" as
          isComplete (shows the Retrospective action), so offering a force-complete
          icon there would contradict a step the UI already presents as done. */}
      {state === "current" && step !== "ship" && onForceStep ? (
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
      {pos
        ? createPortal(
            <div
              role="tooltip"
              className={`spexr-stepper__tooltip spexr-stepper__tooltip--${pos.placement}`}
              style={{
                top: pos.top,
                left: pos.left,
                width: TOOLTIP_WIDTH,
                transform: pos.placement === "above" ? "translateY(-100%)" : undefined,
              }}
            >
              <span className="spexr-stepper__tooltip-title">{label}</span>
              <span className="spexr-stepper__tooltip-body">{preview}</span>
            </div>,
            document.body,
          )
        : null}
    </li>
  );
};

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
  <>
    <ol className="spexr-stepper" role="list" aria-label="Spec workflow">
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
    </ol>
    {planTasks && planTasks.length > 0 ? (
      <PlanChecklist tasks={planTasks} {...(onTaskToggle ? { onToggle: onTaskToggle } : {})} />
    ) : null}
  </>
);

const PlanChecklist: React.FC<{
  readonly tasks: readonly PlanTask[];
  readonly onToggle?: (taskId: string) => void;
}> = ({ tasks, onToggle }) => {
  const doneCount = tasks.filter((t) => t.done).length;
  return (
    <div className="spexr-plan-checklist" aria-label="Implementation tasks">
      <div className="spexr-plan-checklist__header">
        Tasks — {doneCount}/{tasks.length}
      </div>
      <ul className="spexr-plan-checklist__list" role="list">
        {tasks.map((task) => (
          <li key={task.id} className="spexr-plan-checklist__item">
            <label className="spexr-plan-checklist__label">
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => onToggle?.(task.id)}
                aria-label={`${task.id} (${task.acRef}): ${task.description}`}
              />
              <span className={`spexr-plan-checklist__text${task.done ? " spexr-plan-checklist__text--done" : ""}`}>
                <span className="spexr-plan-checklist__ac-ref">{task.acRef}</span>
                {task.description}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
};

export interface WorkspaceProgressBarProps {
  readonly percent: number;
  readonly specCount: number;
}

export const WorkspaceProgressBar: React.FC<WorkspaceProgressBarProps> = ({
  percent,
  specCount,
}) => (
  <div className="spexr-progress" role="group" aria-label="Workspace workflow progression">
    <div className="spexr-progress__head">
      <span className="spexr-progress__label">Workspace progression</span>
      <span className="spexr-progress__value">
        {percent}% · {specCount} {specCount === 1 ? "spec" : "specs"}
      </span>
    </div>
    <div
      className="spexr-progress__bar"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="spexr-progress__fill" style={{ width: `${percent}%` }} />
    </div>
  </div>
);
