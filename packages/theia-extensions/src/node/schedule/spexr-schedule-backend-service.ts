import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { randomUUID } from "node:crypto";
import type { Schedule, TaskLaunch, ValidationProblem } from "../../common/schedule/schedule-types.js";
import type { ScheduleSnapshot, SpexrScheduleClient, SpexrScheduleService } from "../../common/schedule/schedule-protocol.js";
import { validateSchedule } from "../../common/schedule/schedule-validate.js";
import { SpexrDarkfactoryBackendService } from "../darkfactory/spexr-darkfactory-backend-service.js";
import { loadSchedules, saveSchedules, type ScheduleFile } from "./schedule-store.js";
import { ScheduleRunner } from "./schedule-runner.js";
import { SchedulePty } from "./schedule-pty.js";
import { defaultClaudeWatchDeps, everyMs, watchClaudeTask } from "./claude-task-watcher.js";
import { SCAN_EVERY_MS, watchOpencodeTask } from "./opencode-task-watcher.js";

@injectable()
export class SpexrScheduleBackendService implements SpexrScheduleService {
  @inject(SchedulePty) private readonly pty!: SchedulePty;
  @inject(SpexrDarkfactoryBackendService) private readonly wall!: SpexrDarkfactoryBackendService;
  private client: SpexrScheduleClient | undefined;
  private runner!: Promise<ScheduleRunner>;

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
    const runner = await this.runner;
    if (runner.current.runs[schedule.id]?.status === "running") {
      return [{ field: "run", message: "Abort the run before editing its schedule." }];
    }
    const others = runner.current.schedules.filter((s) => s.id !== schedule.id);
    await runner.setSchedules([...others, schedule]);
    return validateSchedule(schedule);
  }

  async remove(scheduleId: string): Promise<void> {
    const runner = await this.runner;
    if (runner.current.runs[scheduleId]?.status === "running") throw new Error("Abort the run before deleting its schedule.");
    await runner.setSchedules(runner.current.schedules.filter((s) => s.id !== scheduleId));
  }

  async run(scheduleId: string, launches: Record<string, TaskLaunch>): Promise<ValidationProblem[]> {
    return (await this.runner).run(scheduleId, launches);
  }

  async abort(scheduleId: string): Promise<void> {
    await (await this.runner).abort(scheduleId);
  }

  private ports(): ConstructorParameters<typeof ScheduleRunner>[0] {
    return {
      launch: (line, cwd) => this.pty.launch(line, cwd),
      onExit: (id, l) => this.pty.onExit(id, l),
      watchClaude: (req, l) => watchClaudeTask(req, defaultClaudeWatchDeps, l),
      watchOpencode: (req, l) =>
        watchOpencodeTask(req, this.wall, { now: () => Date.now(), every: everyMs(SCAN_EVERY_MS) }, l),
      rename: (id, name) => this.wall.renameSession(id, name),
      newSessionId: () => randomUUID(),
      now: () => Date.now(),
      save: (file: ScheduleFile) => saveSchedules(file),
      publish: (file: ScheduleFile) => this.client?.onSnapshot({ schedules: file.schedules, runs: file.runs }),
    };
  }
}
