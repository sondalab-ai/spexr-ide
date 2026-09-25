import { ContainerModule } from "@theia/core/shared/inversify";
import { ConnectionHandler, RpcConnectionHandler } from "@theia/core/lib/common/messaging";
import { SpexrDecisionBackendService } from "./decision/decision-backend-service.js";
import { DECISION_SERVICE_PATH } from "../common/decision-protocol.js";
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
import { RESOURCE_SERVICE_PATH } from "../common/resource-protocol.js";
import { SpexrResourceBackendService } from "./resources/spexr-resource-backend-service.js";
import { POWER_SERVICE_PATH, type SpexrPowerService } from "../common/power-protocol.js";
import { SpexrPowerBackendService, followPowerSaving } from "./power/spexr-power-backend-service.js";

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
  bind(SpexrDecisionBackendService).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue(
      (ctx) => new RpcConnectionHandler(DECISION_SERVICE_PATH, () => ctx.container.get(SpexrDecisionBackendService)),
    )
    .inSingletonScope();
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

  // Pull only: one shared sample serves every window (a push would reach only the newest).
  bind(SpexrResourceBackendService).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue(
      (ctx) => new RpcConnectionHandler(RESOURCE_SERVICE_PATH, () => ctx.container.get(SpexrResourceBackendService)),
    )
    .inSingletonScope();

  bind(SpexrPowerBackendService).toSelf().inSingletonScope();
  bind(BackendApplicationContribution).toService(SpexrPowerBackendService);
  // Windows get state() alone, not the service's lifecycle methods.
  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const power = ctx.container.get(SpexrPowerBackendService);
      const facade: SpexrPowerService = { state: () => power.state() };
      return new RpcConnectionHandler(POWER_SERVICE_PATH, () => facade);
    })
    .inSingletonScope();
  // Resolved per change, not up front, so power saving never builds these services early.
  bind(BackendApplicationContribution)
    .toDynamicValue((ctx) => ({
      initialize: () => {
        followPowerSaving(ctx.container.get(SpexrPowerBackendService), {
          pauseRunningJobs: () => ctx.container.get(SpexrSearchBackendService).pauseRunningJobs(),
          resumeDescriptionJob: (root) => ctx.container.get(SpexrSearchBackendService).resumeDescriptionJob(root),
          setPollingPaused: (paused) => ctx.container.get(SpexrDarkfactoryBackendService).setPollingPaused(paused),
        });
      },
    }))
    .inSingletonScope();
});
