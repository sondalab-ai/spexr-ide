import type { SpexrTerminalBlocksService } from "../../common/terminal-blocks-protocol.js";

/** Symbol for the backend terminal-blocks service proxy in the frontend (S6l), bound to a WebSocketConnectionProvider proxy. */
export const SpexrTerminalBlocksServiceProxy = Symbol("SpexrTerminalBlocksServiceProxy");

export type { SpexrTerminalBlocksService };
