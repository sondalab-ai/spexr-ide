import { WebSocketConnectionProvider } from "@theia/core/lib/browser/messaging/ws-connection-provider";
import { DARKFACTORY_SERVICE_PATH, type SpexrDarkfactoryService } from "../../common/darkfactory-protocol.js";

/**
 * Symbol used to inject the backend `SpexrDarkfactoryService` proxy in the frontend.
 *
 * Bind it to a `WebSocketConnectionProvider.createProxy(...)` call in the frontend
 * module so consumers remain transport-agnostic.
 */
export const SpexrDarkfactoryServiceProxy = Symbol("SpexrDarkfactoryServiceProxy");

export { DARKFACTORY_SERVICE_PATH, WebSocketConnectionProvider };
export type { SpexrDarkfactoryService };
