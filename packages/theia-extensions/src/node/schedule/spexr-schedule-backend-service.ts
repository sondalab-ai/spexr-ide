import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { randomUUID } from "node:crypto";
import type { Schedule, TaskLaunch, ValidationProblem } from "../../common/schedule/schedule-types.js";
import type { ScheduleSnapshot, SpexrScheduleClient, SpexrScheduleService } from "../../common/schedule/schedule-protocol.js";
import { SpexrDarkfactoryBackendService } from "../darkfactory/spexr-darkfactory-backend-service.js";
import { loadSchedules, saveSchedules, type ScheduleFile } from "./schedule-store.js";
import { ScheduleRunner } from "./schedule-runner.js";
import { SchedulePty } from "./schedule-pty.js";
import { defaultClaudeWatchDeps, watchClaudeTask } from "./claude-task-watcher.js";
import { watchOpencodeTask } from "./opencode-task-watcher.js";
import { CheckQueue, runCheck } from "./check-runner.js";
import { Workspaces } from "./workspace.js";

@injectable()
export class SpexrScheduleBackendService implements SpexrScheduleService {
  @inject(SchedulePty) private readonly pty!: SchedulePty;
  @inject(SpexrDarkfactoryBackendService) private readonly wall!: SpexrDarkfactoryBackendService;
  private client: SpexrScheduleClient | undefined;
  private runner!: Promise<ScheduleRunner>;
  /** One queue for the whole backend (the service is a singleton): checks never overlap. */
  private readonly checks = new CheckQueue((req) => runCheck(req));
  /** One per backend (the service is a singleton): worktree changes are serialized per repository (R17). */
  private readonly workspaces = new Workspaces();

  @postConstruct()
  protected init(): void {
    this.runner = loadSchedules().then(async (file) => {
      const runner = new ScheduleRunner(this.ports(), file);
      await runner.recover();
      return runner;
    });
  }

  setClient(client: SpexrScheduleClient | undefined): void {
    this.client = client;
  }

  async snapshot(): Promise<ScheduleSnapshot> {
    const { schedules, runs } = (await this.runner).current;
    return { schedules, runs };
  }

  async save(schedule: Schedule): Promise<ValidationProblem[]> {
    return (await this.runner).saveSchedule(schedule);
  }

  async remove(scheduleId: string): Promise<void> {
    await (await this.runner).removeSchedule(scheduleId);
  }

  async run(scheduleId: string, launches: Record<string, TaskLaunch>): Promise<ValidationProblem[]> {
    return (await this.runner).run(scheduleId, launches);
  }

  async abort(scheduleId: string): Promise<void> {
    await (await this.runner).abort(scheduleId);
  }

  async pause(scheduleId: string): Promise<void> {
    await (await this.runner).pause(scheduleId);
  }

  async resume(scheduleId: string): Promise<void> {
    await (await this.runner).resume(scheduleId);
  }

  async retry(scheduleId: string, taskId: string, launch: TaskLaunch): Promise<ValidationProblem[]> {
    return (await this.runner).retry(scheduleId, taskId, launch);
  }

  async skip(scheduleId: string, taskId: string): Promise<ValidationProblem[]> {
    return (await this.runner).skip(scheduleId, taskId);
  }

  private ports(): ConstructorParameters<typeof ScheduleRunner>[0] {
    return {
      launch: (line, cwd) => this.pty.launch(line, cwd),
      onExit: (id, l) => this.pty.onExit(id, l),
      watchClaude: (req, l) => watchClaudeTask(req, defaultClaudeWatchDeps, l),
      watchOpencode: (req, l) => watchOpencodeTask(req, this.wall, { now: () => Date.now() }, l),
      rename: (id, name) => this.wall.renameSession(id, name),
      newSessionId: () => randomUUID(),
      now: () => Date.now(),
      save: (file: ScheduleFile) => saveSchedules(file),
      publish: (file: ScheduleFile) => this.client?.onSnapshot({ schedules: file.schedules, runs: file.runs }),
      paste: (id, text) => this.pty.paste(id, text),
      check: (req, stillWanted) => this.checks.run(req, stillWanted),
      close: (id, pid) => this.pty.close(id, pid),
      prepareWorktree: (req) => this.workspaces.prepareWorktree(req),
    };
  }
}
