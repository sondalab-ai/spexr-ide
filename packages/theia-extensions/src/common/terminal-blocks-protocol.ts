export const TERMINAL_BLOCKS_SERVICE_PATH = "/services/spexr-terminal-blocks";

/**
 * What the frontend asks the backend about command blocks (S6l). The backend
 * makes a nonce per shell and gives it to the shell's scripts, which print it
 * in every mark of theirs; the terminal learns it here, by terminal id, and
 * never from what the terminal prints.
 */
export interface SpexrTerminalBlocksService {
  /** The nonce of the shell in terminal `terminalId`; undefined when it has none (no blocks for that shell) or is gone. */
  nonce(terminalId: number): Promise<string | undefined>;
  /** The `spexr.terminal.commandBlocks` preference, pushed on start and on change: off, new shells get no spexr marks at all. */
  setEnabled(enabled: boolean): Promise<void>;
}
