import type { SpexrDecisionService } from "../../common/decision-protocol.js";

/**
 * Symbol for the backend decision service proxy in the frontend (spec 0017),
 * bound to a WebSocketConnectionProvider proxy in the frontend module.
 */
export const SpexrDecisionServiceProxy = Symbol("SpexrDecisionServiceProxy");

export type { SpexrDecisionService };
