import { ContainerModule } from "@theia/core/shared/inversify";
import { ConnectionHandler, RpcConnectionHandler } from "@theia/core/lib/common/messaging";
import { BackendApplicationContribution } from "@theia/core/lib/node/backend-application";
import { WebsocketFrontendConnectionService } from "@theia/core/lib/node/messaging/websocket-frontend-connection-service";
import { SpexrWebsocketFrontendConnectionService } from "./spexr-frontend-connection-service.js";
import { SpexrParentWatchdog } from "./spexr-parent-watchdog.js";
import { AGENT_SESSION_SERVICE_PATH } from "../common/agent-protocol.js";
import { GIT_SERVICE_PATH, type SpexrGitClient } from "../common/git-protocol.js";
import { SpexrAgentBackendService } from "./spexr-agent-backend-service.js";
import { SpexrGitBackendService } from "./spexr-git-backend-service.js";
import { SEARCH_SERVICE_PATH, type SpexrSearchClient } from "../common/search-protocol.js";
import { EmbedderToken, TransformersEmbedder, type Embedder } from "./search/embedding-model.js";
import { DescriptionGeneratorToken, type DescriptionGenerator } from "./search/description-format.js";
import { WorkerDescriptionGenerator } from "./search/worker-description-generator.js";
import { SpexrSearchBackendService } from "./search/spexr-search-backend-service.js";
import { DARKFACTORY_SERVICE_PATH, type SpexrDarkfactoryClient } from "../common/darkfactory-protocol.js";
import { SpexrDarkfactoryBackendService } from "./darkfactory/spexr-darkfactory-backend-service.js";

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
  // Guard Theia 1.75 against exiting on a double socket close; see the service doc.
  // Unguarded on purpose: the generated backend loads `messagingBackendModule`
  // before this one, so an upgrade that moves the binding should fail loudly
  // rather than leave the crash guard silently uninstalled.
  rebind(WebsocketFrontendConnectionService).to(SpexrWebsocketFrontendConnectionService).inSingletonScope();

  bind(SpexrParentWatchdog).toSelf().inSingletonScope();
  bind(BackendApplicationContribution).toService(SpexrParentWatchdog);

  bind(SpexrAgentBackendService).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const service = ctx.container.get(SpexrAgentBackendService);
      return new RpcConnectionHandler(AGENT_SESSION_SERVICE_PATH, () => service);
    })
    .inSingletonScope();

  bind(SpexrGitBackendService)
    .toDynamicValue(
      (ctx) =>
        new SpexrGitBackendService({
          generator: ctx.container.get<DescriptionGenerator>(DescriptionGeneratorToken),
        }),
    )
    .inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const service = ctx.container.get(SpexrGitBackendService);
      return new RpcConnectionHandler<SpexrGitClient>(GIT_SERVICE_PATH, (client) => {
        service.setClient(client);
        return service;
      });
    })
    .inSingletonScope();

  bind(EmbedderToken).to(TransformersEmbedder).inSingletonScope();
  bind(DescriptionGeneratorToken).to(WorkerDescriptionGenerator).inSingletonScope();
  bind(SpexrSearchBackendService).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const service = ctx.container.get(SpexrSearchBackendService);
      return new RpcConnectionHandler<SpexrSearchClient>(SEARCH_SERVICE_PATH, (client) => {
        service.setClient(client);
        return service;
      });
    })
    .inSingletonScope();

  bind(SpexrDarkfactoryBackendService)
    .toDynamicValue(
      (ctx) =>
        new SpexrDarkfactoryBackendService({
          generator: ctx.container.get<DescriptionGenerator>(DescriptionGeneratorToken),
          embed: (texts) => ctx.container.get<Embedder>(EmbedderToken).embed(texts),
        }),
    )
    .inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const service = ctx.container.get(SpexrDarkfactoryBackendService);
      return new RpcConnectionHandler<SpexrDarkfactoryClient>(DARKFACTORY_SERVICE_PATH, (client) => {
        service.setClient(client);
        return service;
      });
    })
    .inSingletonScope();
});
