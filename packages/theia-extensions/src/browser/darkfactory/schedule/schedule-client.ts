import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { ScheduleSnapshot, SpexrScheduleClient } from "../../../common/schedule/schedule-protocol.js";

export const SpexrScheduleServiceProxy = Symbol("SpexrScheduleServiceProxy");

/** Receives the backend's schedule snapshots; the sidebar and the wall subscribe. */
@injectable()
export class SpexrScheduleClientDispatcher implements SpexrScheduleClient {
  private readonly snapshots = new Emitter<ScheduleSnapshot>();
  readonly onSnapshot$: Event<ScheduleSnapshot> = this.snapshots.event;

  onSnapshot(snapshot: ScheduleSnapshot): void {
    this.snapshots.fire(snapshot);
  }
}
