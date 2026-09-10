import { describe, expect, test } from "vitest";
import { Container } from "@theia/core/shared/inversify";
import { messagingBackendModule } from "@theia/core/lib/node/messaging/messaging-backend-module";
import { FrontendConnectionService } from "@theia/core/lib/node/messaging/frontend-connection-service";
import { ILogger } from "@theia/core/lib/common";
import { WebsocketEndpoint } from "@theia/core/lib/node/messaging/websocket-endpoint";
import spexrBackendModule from "./spexr-backend-module.js";
import { SpexrWebsocketFrontendConnectionService } from "./spexr-frontend-connection-service.js";

/**
 * The generated backend loads `messagingBackendModule` first, then ours; mirror
 * that order so the rebind is exercised exactly as it is at runtime.
 */
function loadedContainer() {
  const container = new Container();
  container.load(messagingBackendModule);
  container.load(spexrBackendModule);
  container.bind(ILogger).toConstantValue({ info: () => {} });
  container.rebind(WebsocketEndpoint).toConstantValue({ registerConnectionHandler: () => {} });
  return container;
}

describe("spexr backend module", () => {
  test("FrontendConnectionService resolves to the double-close-safe subclass", () => {
    expect(loadedContainer().get(FrontendConnectionService)).toBeInstanceOf(
      SpexrWebsocketFrontendConnectionService,
    );
  });
});
