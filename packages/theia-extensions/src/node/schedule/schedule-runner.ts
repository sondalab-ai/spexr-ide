import { randomUUID } from "node:crypto";
import {
  ACTIVE_STATUSES,
  RETRYABLE_STATUSES,
  type RunState,
  type Schedule,
  type ScheduleTask,
  type TaskLaunch,
  type ValidationProblem,
} from "../../common/schedule/schedule-types.js";
import { validateSchedule } from "../../common/schedule/schedule-validate.js";
import { buildLaunchLine } from "../../common/harness/launch-line.js";
import { buildTaskArgs } from "../../common/schedule/task-args.js";
import { startRun, step, workspacePlan, type Effect, type EngineEvent } from "./schedule-engine.js";
import type { ScheduleFile } from "./schedule-store.js";
import type { TaskWatch, WatchEvent } from "./claude-task-watcher.js";
import type { CheckRequest, CheckResult } from "./check-runner.js";
import type { WorktreeRequest } from "./workspace.js";

/** Everything the runner does to the outside world; injected so every rule is testable. */
export interface RunnerPorts {
  launch(line: string, cwd: string): Promise<{ terminalId: number; processId: number }>;
  onExit(terminalId: number, listener: () => void): () => void;
  watchClaude(req: { sessionId: string; configDir: string; permissionMode?: string }, listener: (e: WatchEvent) => void): TaskWatch;
  watchOpencode(req: { workspace: string; permissionMode?: string }, listener: (e: WatchEvent) => void): TaskWatch;
  rename(sessionId: string, name: string): Promise<void>;
  newSessionId(): string;
  now(): number;
  save(file: ScheduleFile): Promise<void>;
  publish(file: ScheduleFile): void;
  /** Bracketed paste, then Enter, into a task's pty. */
  paste(terminalId: number, text: string): Promise<void>;
  /** Queued backend-wide; resolves undefined when `stillWanted` said no once the check's turn came. */
  check(req: CheckRequest, stillWanted: () => boolean): Promise<CheckResult | undefined>;
  /** End a pty, only while it still runs `processId` (R13, R14). */
  close(terminalId: number, processId: number): Promise<void>;
  /** Make (or, with `reuse`, find again) a worktree task's worktree; resolves the folder the task runs in. */
  prepareWorktree(req: WorktreeRequest): Promise<string>;
}

/** Why the backend will not use a launch the frontend resolved (spec, Security), or undefined. */
function launchProblem(launch: TaskLaunch | undefined): ValidationProblem | undefined {
  if (launch?.plan.command.trim() && !/[\n\r]/.test(launch.plan.command)) return undefined;
  return { field: "run", message: "A task has no usable launch command." };
}

/**
 * Owns the schedule file in memory and drives runs: each event goes through
 * the pure engine, the result is saved and published, then its effects run.
 * Events are applied one at a time, in order, per runner. Every check that
 * decides whether a mutation may happen runs inside the same queued step as
 * the mutation itself, so two overlapping calls can never both pass a check
 * that only the first should have passed.
 */
export class ScheduleRunner {
  private queue: Promise<void> = Promise.resolve();
  private readonly releases = new Map<string, (() => void)[]>();
  /** Each active task's watch, so a paste can re-arm it. Dropped with the task's other registrations. */
  private readonly watches = new Map<string, TaskWatch>();

  constructor(
    private readonly ports: RunnerPorts,
    private file: ScheduleFile,
  ) {}

  get current(): ScheduleFile {
    return this.file;
  }

  /** Save (create or replace) a schedule; refuses one whose run is in progress. */
  async saveSchedule(schedule: Schedule): Promise<ValidationProblem[]> {
    return this.serial(async () => {
      if (this.file.runs[schedule.id]?.status === "running") {
        return [{ field: "run", message: "Abort the run before editing its schedule." }];
      }
      const others = this.file.schedules.filter((s) => s.id !== schedule.id);
      this.file = { ...this.file, schedules: [...others, schedule] };
      await this.persist();
      return validateSchedule(schedule);
    });
  }

  /** Delete a schedule and any run state it left behind; refuses one whose run is in progress. */
  async removeSchedule(scheduleId: string): Promise<void> {
    await this.serial(async () => {
      if (this.file.runs[scheduleId]?.status === "running") throw new Error("Abort the run before deleting its schedule.");
      const runs = { ...this.file.runs };
      delete runs[scheduleId];
      this.file = { ...this.file, schedules: this.file.schedules.filter((s) => s.id !== scheduleId), runs };
      await this.persist();
    });
  }

  async run(scheduleId: string, launches: Record<string, TaskLaunch>): Promise<ValidationProblem[]> {
    return this.serial(async () => {
      const schedule = this.schedule(scheduleId);
      if (!schedule) return [{ field: "id", message: "Unknown schedule." }];
      const problems = validateSchedule(schedule);
      if (problems.length > 0) return problems;
      const bad = schedule.tasks.map((t) => launchProblem(launches[t.id])).find((x) => x !== undefined);
      if (bad) return [bad];
      if (this.file.runs[scheduleId]?.status === "running") {
        return [{ field: "run", message: "This schedule is already running." }];
      }
      const { run, effects } = startRun(schedule, launches, randomUUID(), this.ports.now());
      await this.commit(scheduleId, run, effects);
      return [];
    });
  }

  abort(scheduleId: string): Promise<void> {
    return this.dispatch(scheduleId, { type: "abort" });
  }

  /** Operator pause: no new task starts and turn ends are held until resume(). */
  pause(scheduleId: string): Promise<void> {
    return this.dispatch(scheduleId, { type: "pause" });
  }

  /** Undo pause(): held turn ends are replayed in schedule order. */
  resume(scheduleId: string): Promise<void> {
    return this.dispatch(scheduleId, { type: "resume" });
  }

  /**
   * Start a failed or interrupted task again from iteration 1 in the same
   * workspace, with the launch the frontend resolved just now (R11–R13, R15,
   * R22). Returns why not instead (R21).
   */
  retry(scheduleId: string, taskId: string, launch: TaskLaunch): Promise<ValidationProblem[]> {
    return this.serial(async () => {
      const problem = this.taskActionProblem(scheduleId, taskId) ?? launchProblem(launch);
      if (problem) return [problem];
      await this.stepNow(scheduleId, { type: "retry", task: taskId, launch });
      return [];
    });
  }

  /** Let a failed or interrupted task's dependents start without it; returns why not instead (R21). */
  skip(scheduleId: string, taskId: string): Promise<ValidationProblem[]> {
    return this.serial(async () => {
      const problem = this.taskActionProblem(scheduleId, taskId);
      if (problem) return [problem];
      await this.stepNow(scheduleId, { type: "skip", task: taskId });
      return [];
    });
  }

  /** Why retry or skip cannot apply (R21); read inside the queue, against the state it would change. */
  private taskActionProblem(scheduleId: string, taskId: string): ValidationProblem | undefined {
    const run = this.file.runs[scheduleId];
    if (!this.schedule(scheduleId) || run?.status !== "running") return { field: "run", message: "This schedule is not running." };
    const state = run.tasks[taskId];
    if (!state || !RETRYABLE_STATUSES.has(state.status)) {
      return { task: taskId, field: "run", message: "Only a failed or interrupted task can be retried or skipped." };
    }
    return undefined;
  }

  /** Apply an operator event from inside the queue; dispatch() would queue behind the caller and never run. */
  private async stepNow(scheduleId: string, event: EngineEvent): Promise<void> {
    const { run, effects } = step(this.schedule(scheduleId)!, this.file.runs[scheduleId]!, event);
    await this.commit(scheduleId, run, effects);
  }

  /** The folder a task runs in (R20): its project, its worktree (made or reused, R15), or its upstream's real folder. */
  private async workspaceFor(schedule: Schedule, run: RunState, task: ScheduleTask, reuse: boolean): Promise<string> {
    const plan = workspacePlan(schedule, run, task.id);
    if (plan.kind === "path") return plan.path;
    if (plan.kind === "missing") throw new Error(plan.reason);
    return this.ports.prepareWorktree({ project: task.project, scheduleId: schedule.id, taskId: task.id, reuse });
  }

  /** On backend start: tasks that were running when the app went away are interrupted. */
  async recover(): Promise<void> {
    for (const id of Object.keys(this.file.runs)) await this.dispatch(id, { type: "recover" });
  }

  /**
   * `runId`, when given, binds the event to the run that produced it: inside
   * the same queued step that would otherwise apply it, a run that Abort→Run
   * has since superseded makes the event a no-op. This is the guarantee — a
   * caller cannot rely on the world still looking the way it did when the
   * event was raised, since Abort and Run may have been queued (though not
   * yet applied) in between. Operator events (abort, recover) carry no
   * `runId`: they always apply to whatever run is current when their turn
   * in the queue comes.
   */
  dispatch(scheduleId: string, event: EngineEvent, runId?: string): Promise<void> {
    return this.serial(async () => {
      const schedule = this.schedule(scheduleId);
      const prev = this.file.runs[scheduleId];
      if (!schedule || !prev) {
        if (event.type === "started") await this.closeTerminal(event); // R14: its run and schedule are gone
        return;
      }
      const stale = runId !== undefined && prev.runId !== runId;
      // R14: a pty that started for a run that is gone has no card and nothing watching it.
      if (event.type === "started" && (stale || prev.status !== "running")) await this.closeTerminal(event);
      if (stale) return;
      const { run, effects } = step(schedule, prev, event);
      await this.commit(scheduleId, run, effects);
    });
  }

  private schedule(id: string): Schedule | undefined {
    return this.file.schedules.find((s) => s.id === id);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async persist(): Promise<void> {
    await this.ports.save(this.file);
    this.ports.publish(this.file);
  }

  private async commit(scheduleId: string, run: RunState, effects: Effect[]): Promise<void> {
    this.file = { ...this.file, runs: { ...this.file.runs, [scheduleId]: run } };
    await this.persist();
    for (const [taskId, t] of Object.entries(run.tasks)) {
      if (run.status !== "running" || !ACTIVE_STATUSES.has(t.status)) this.release(scheduleId, taskId);
    }
    for (const e of effects) {
      // Fire-and-forget: perform() reports its own failures back through
      // dispatch(); this only guards against it rejecting outright (a bug),
      // which must not become an unhandled rejection.
      void this.perform(scheduleId, run.runId, e).catch((err) => console.error("[schedule] effect failed", err));
    }
  }

  /** Stop and drop whatever a task's key currently holds — never leaves an entry silently overwritten. */
  private release(scheduleId: string, taskId: string): void {
    const key = `${scheduleId}/${taskId}`;
    for (const stop of this.releases.get(key) ?? []) stop();
    this.releases.delete(key);
    this.watches.delete(key);
  }

  private registerReleases(scheduleId: string, taskId: string, stops: (() => void)[]): void {
    this.release(scheduleId, taskId);
    this.releases.set(`${scheduleId}/${taskId}`, stops);
  }

  private async perform(scheduleId: string, runId: string, e: Effect): Promise<void> {
    switch (e.type) {
      case "name":
        await this.ports.rename(e.sessionId, e.name).catch((err) => console.error("[schedule] renaming the session failed", err));
        return;
      case "paste":
        // Re-armed first: the reply to this paste counts even if it lands between
        // two reads, and the reply still on screen never counts twice (R1).
        this.watches.get(`${scheduleId}/${e.task}`)?.arm();
        await this.ports.paste(e.terminalId, e.text).catch((err) => console.error("[schedule] pasting the follow-up failed", err));
        return;
      case "check":
        await this.check(scheduleId, runId, e);
        return;
      case "close":
        await this.closeTerminal(e);
        return;
      case "start":
        await this.start(scheduleId, runId, e);
        return;
      default: {
        const unknown: never = e;
        throw new Error(`Unknown effect: ${JSON.stringify(unknown)}`);
      }
    }
  }

  /** Close a pty the run no longer wants (R13, R14); the port checks the process id first. */
  private async closeTerminal(t: { terminalId: number; processId: number }): Promise<void> {
    await this.ports.close(t.terminalId, t.processId).catch((err) => console.error("[schedule] closing a session failed", err));
  }

  /** Launch a task's pty and register its watcher and exit listener; every outcome goes back through dispatch(), bound to `runId`. */
  private async start(scheduleId: string, runId: string, e: Extract<Effect, { type: "start" }>): Promise<void> {
    const schedule = this.schedule(scheduleId);
    const task = schedule?.tasks.find((t) => t.id === e.task);
    const run = this.file.runs[scheduleId];
    const launch = task && run?.launches[task.id];
    // Bound to this run: dispatch() drops it inside the queue if Abort→Run has since replaced run `runId`.
    const send = (event: EngineEvent): void => {
      void this.dispatch(scheduleId, event, runId).catch((err) => console.error("[schedule] dispatch failed", err));
    };
    // An early-out only: it reads `this.file` outside the queue, so on a busy
    // queue it can still see a superseded run as current and register a
    // watcher for it. Abort's commit() releases that registration, and
    // dispatch() drops the stale "started" and closes its pty (R14).
    const isCurrentRun = (): boolean => {
      const current = this.file.runs[scheduleId];
      return !!current && current.runId === runId && current.status === "running";
    };
    if (!schedule || !task || !run || !launch) {
      send({ type: "start-failed", task: e.task, error: "The task is no longer in the schedule." });
      return;
    }
    let workspace: string;
    try {
      workspace = await this.workspaceFor(schedule, run, task, e.reuse === true);
    } catch (err) {
      if (isCurrentRun()) send({ type: "start-failed", task: task.id, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!isCurrentRun()) return;
    const sessionId = task.harness === "claude" ? this.ports.newSessionId() : undefined;
    const line = buildLaunchLine({
      plan: launch.plan,
      args: buildTaskArgs(task, e.prompt, sessionId),
      cwd: workspace,
      ownsAccount: task.harness === "claude",
      keepShell: false,
    });
    let terminal: { terminalId: number; processId: number };
    try {
      terminal = await this.ports.launch(line, workspace);
    } catch (err) {
      if (!isCurrentRun()) return;
      send({ type: "start-failed", task: task.id, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!isCurrentRun()) {
      // R14: the run was aborted or replaced while this pty started; it has no card and no watcher.
      await this.closeTerminal(terminal);
      return;
    }
    const onWatch = (w: WatchEvent): void => send({ ...w, task: task.id } as EngineEvent);
    const registered: (() => void)[] = [];
    let watch: TaskWatch;
    try {
      watch =
        task.harness === "claude"
          ? this.ports.watchClaude(
              {
                sessionId: sessionId!,
                configDir: launch.configDir,
                ...(task.permissionMode ? { permissionMode: task.permissionMode } : {}),
              },
              onWatch,
            )
          : this.ports.watchOpencode({ workspace, ...(task.permissionMode ? { permissionMode: task.permissionMode } : {}) }, onWatch);
      registered.push(() => watch.stop());
      const stopExit = this.ports.onExit(terminal.terminalId, () => send({ type: "exited", task: task.id }));
      registered.push(stopExit);
    } catch (err) {
      for (const stop of registered) stop();
      send({ type: "start-failed", task: task.id, error: err instanceof Error ? err.message : String(err) });
      await this.closeTerminal(terminal); // R14: nothing would ever watch it
      return;
    }
    this.registerReleases(scheduleId, task.id, registered);
    this.watches.set(`${scheduleId}/${task.id}`, watch);
    send({ type: "started", task: task.id, ...terminal, workspace, ...(sessionId ? { sessionId } : {}) });
  }

  /**
   * Queue the task's check. When its turn comes it runs only if the same run
   * is still going and the task still waits on it (R9); its result goes back
   * bound to that run. A check that throws counts as failed, with the reason
   * as its output.
   */
  private async check(scheduleId: string, runId: string, e: Extract<Effect, { type: "check" }>): Promise<void> {
    const stillWanted = (): boolean => {
      const run = this.file.runs[scheduleId];
      return run?.runId === runId && run.status === "running" && run.tasks[e.task]?.status === "checking";
    };
    let result: CheckResult | undefined;
    try {
      result = await this.ports.check({ command: e.command, cwd: e.cwd, timeoutMs: e.timeoutSec * 1000 }, stillWanted);
    } catch (err) {
      result = { ok: false, tail: `The check could not run: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!result) return;
    await this.dispatch(scheduleId, { type: "check-done", task: e.task, ok: result.ok, tail: result.tail }, runId);
  }
}
