import type { HarnessId } from "../harness/harness-types.js";
import type { LaunchPlan } from "../claude-launch-profiles.js";

export const SCHEDULE_ID_PATTERN = /^[a-z0-9-]{1,32}$/;
export const MODEL_PATTERN = /^[A-Za-z0-9._/:[\]-]{1,100}$/;
export const MAX_ITERATIONS = 50;
export const MAX_PROMPT_CHARS = 20_000;
export const DEFAULT_CHECK_TIMEOUT_SEC = 600;
/** A check longer than an hour is not a gate a loop should wait on. */
export const MAX_CHECK_TIMEOUT_SEC = 3_600;
export const SCHEDULE_HARNESSES: readonly HarnessId[] = ["claude", "opencode"];
export const PERMISSION_MODES: Readonly<Record<HarnessId, readonly string[]>> = {
  claude: ["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"],
  opencode: ["auto"],
};
/** Modes that approve tools without asking; the editor and the task row warn about them. */
export const UNATTENDED_MODES: Readonly<Record<HarnessId, readonly string[]>> = {
  claude: ["auto", "bypassPermissions"],
  opencode: ["auto"],
};

export type TaskWorkspace = { kind: "folder" } | { kind: "worktree" } | { kind: "sameAs"; task: string };

export interface TaskLoop {
  stopCriteria: string;
  followUp: string;
  maxIterations: number;
  check?: string;
  checkTimeoutSec?: number;
}

export interface ScheduleTask {
  id: string;
  name: string;
  needs: string[];
  project: string;
  workspace: TaskWorkspace;
  harness: HarnessId;
  configDir?: string;
  model?: string;
  permissionMode?: string;
  prompt: string;
  loop?: TaskLoop;
}

export interface Schedule {
  id: string;
  name: string;
  tasks: ScheduleTask[];
}

/** One validation problem; `task` absent means the schedule itself. */
export interface ValidationProblem {
  task?: string;
  field: string;
  message: string;
}

export type TaskStatus =
  | "pending"
  | "starting"
  | "running"
  | "waiting-on-you"
  | "checking"
  | "held"
  | "converged"
  | "failed"
  | "skipped"
  | "interrupted";

/** A task's status is one of these while a session may still be doing its work. */
export const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "starting",
  "running",
  "waiting-on-you",
  "checking",
  "held",
]);
/** A dependent may start once every task it needs is in one of these. */
export const SETTLED_STATUSES: ReadonlySet<TaskStatus> = new Set(["converged", "skipped"]);

export interface TaskRunState {
  status: TaskStatus;
  iteration: number;
  sessionId?: string;
  terminalId?: number;
  processId?: number;
  workspace?: string;
  reply?: string;
  /** A failed check's output, kept while its follow-up is held by an operator pause. */
  checkTail?: string;
  error?: string;
}

/** How the frontend resolved a task's launch: the command and the account dir. */
export interface TaskLaunch {
  plan: LaunchPlan;
  /** The Claude account dir the session runs under; "" is the default account (~/.claude). */
  configDir: string;
}

export type RunStatus = "running" | "finished" | "aborted";

export interface RunState {
  scheduleId: string;
  runId: string;
  status: RunStatus;
  /**
   * Set while no new task may start. "operator": the operator paused the run
   * (turn ends are held too); it wins over a failure and resume() recomputes
   * the failure pause from the task statuses. "failure": a task is failed or
   * interrupted.
   */
  pausedBy?: "operator" | "failure";
  startedAtMs: number;
  tasks: Record<string, TaskRunState>;
  launches: Record<string, TaskLaunch>;
}
