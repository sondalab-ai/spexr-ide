import type { RunState, Schedule, TaskLaunch, ValidationProblem } from "./schedule-types.js";

export const SCHEDULE_SERVICE_PATH = "/services/spexr/schedules";

export interface ScheduleSnapshot {
  schedules: Schedule[];
  runs: Record<string, RunState>;
}

/** Frontend → backend. Runs live in the backend; a window reload loses nothing. */
export interface SpexrScheduleService {
  snapshot(): Promise<ScheduleSnapshot>;
  /** Saved even when invalid; the problems say why it cannot run. */
  save(schedule: Schedule): Promise<ValidationProblem[]>;
  remove(scheduleId: string): Promise<void>;
  /** Starts a run; returns the problems instead when the schedule cannot run. */
  run(scheduleId: string, launches: Record<string, TaskLaunch>): Promise<ValidationProblem[]>;
  abort(scheduleId: string): Promise<void>;
  /** Operator pause: no new task starts, and turn ends wait (held) until resume. */
  pause(scheduleId: string): Promise<void>;
  /** Undo pause: held turn ends are judged now, in schedule order. */
  resume(scheduleId: string): Promise<void>;
}

/** Backend → frontend (reaches the most recently opened window, like the wall). */
export interface SpexrScheduleClient {
  onSnapshot(snapshot: ScheduleSnapshot): void;
}
