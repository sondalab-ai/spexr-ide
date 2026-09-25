import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { SpexrGitClient } from "../../common/git-protocol.js";

export const SpexrGitClientToken = Symbol("SpexrGitClientDispatcher");

/**
 * Singleton client registered on the git RPC proxy. The backend pushes here
 * whenever the repository moves on disk — including from an agent's terminal.
 */
@injectable()
export class SpexrGitClientDispatcher implements SpexrGitClient {
  private readonly emitter = new Emitter<string>();
  /** Fires the root of the repository that changed. */
  readonly onRepositoryChanged$: Event<string> = this.emitter.event;

  onRepositoryChanged(root: string): void {
    this.emitter.fire(root);
  }
}
