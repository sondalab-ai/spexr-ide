import { inject, injectable } from "@theia/core/shared/inversify";
import { ProcessManager } from "@theia/process/lib/node/process-manager";
import type { SpexrTerminalBlocksService } from "../../common/terminal-blocks-protocol.js";

/** The environment variable the injector passes a shell's nonce in: the scripts take it out of the environment first thing. */
export const NONCE_ENV = "SPEXR_BLOCK_NONCE";

const NONCE = /^[0-9a-f]{32}$/;

/** The slice of a terminal process that holds the options it was started with. */
interface ProcessWithOptions {
  readonly options?: { readonly options?: { readonly env?: Readonly<Record<string, string | undefined>> } };
}

/**
 * The backend side of command blocks (S6l): whether they are on, and the
 * nonce each shell was started with, read back from the process's own start
 * options so there is no second table to keep in step with Theia's terminal ids.
 */
@injectable()
export class SpexrTerminalBlocksBackend implements SpexrTerminalBlocksService {
  @inject(ProcessManager) private readonly processes!: ProcessManager;
  private on = true;

  get enabled(): boolean {
    return this.on;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.on = enabled;
  }

  async nonce(terminalId: number): Promise<string | undefined> {
    const process = this.processes.get(terminalId) as unknown as ProcessWithOptions | undefined;
    const value = process?.options?.options?.env?.[NONCE_ENV];
    return typeof value === "string" && NONCE.test(value) ? value : undefined;
  }
}
