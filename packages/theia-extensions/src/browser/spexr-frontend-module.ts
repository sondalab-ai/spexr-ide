import { ContainerModule } from "@theia/core/shared/inversify";
import { CommandContribution, MenuContribution } from "@theia/core";
import {
  bindViewContribution,
  FrontendApplicationContribution,
  KeybindingContribution,
  WidgetFactory,
} from "@theia/core/lib/browser";
import { TabBarToolbarContribution } from "@theia/core/lib/browser/shell/tab-bar-toolbar";
import { ColorContribution } from "@theia/core/lib/browser/color-application-contribution";
import { PreferenceContribution } from "@theia/core/lib/common/preferences/preference-schema";
import { WebSocketConnectionProvider } from "@theia/core/lib/browser/messaging/ws-connection-provider";
import { SpexrCommandsContribution } from "./commands/spexr-commands-contribution.js";
import { SpexrSpecEditorToolbarContribution } from "./views/spec-editor-toolbar-contribution.js";
import { SpexrAgentTerminalToolbarContribution } from "./views/agent-terminal-toolbar-contribution.js";
import { SpexrSpecRelationsContribution } from "./spec/spec-relations-contribution.js";
import { SpexrSpecViewContribution, SPEC_VIEW_ID } from "./views/spec-view-contribution.js";
import { SpexrSpecWidget } from "./views/spec-widget.js";
import { SpexrMemoryViewContribution, MEMORY_VIEW_ID } from "./views/memory-view-contribution.js";
import { SpexrMemoryWidget } from "./views/memory-widget.js";
import {
  SpexrExpertsViewContribution,
  EXPERTS_VIEW_ID,
} from "./views/experts-view-contribution.js";
import { SpexrExpertsWidget } from "./views/experts-widget.js";
import {
  SpexrSpecResourcesViewContribution,
  SPEC_RESOURCES_VIEW_ID,
} from "./views/spec-resources-view-contribution.js";
import { SpexrSpecResourcesWidget } from "./views/spec-resources-widget.js";
import { SpexrSpecResourcesVisibilityContribution } from "./views/spec-resources-visibility-contribution.js";
import {
  SpexrSpecLintViewContribution,
  SPEC_LINT_VIEW_ID,
} from "./views/spec-lint-view-contribution.js";
import { SpexrSpecLintWidget } from "./views/spec-lint-widget.js";
import { SpexrSpecLintVisibilityContribution } from "./views/spec-lint-visibility-contribution.js";
import { SpexrSpecPreviewWidget, SPEC_PREVIEW_VIEW_ID } from "./views/spec-preview-widget.js";
import { SpexrSpecPreviewContribution } from "./views/spec-preview-contribution.js";
import { SpexrSpecExternalReloadContribution } from "./views/spec-external-reload-contribution.js";
import {
  SpexrWelcomeViewContribution,
  WELCOME_VIEW_ID,
} from "./views/welcome-view-contribution.js";
import { SpexrWelcomeWidget } from "./views/welcome-widget.js";
import { SpexrShellLayoutContribution } from "./shell/spexr-shell-layout-contribution.js";
import { SpexrRevealOnRestore } from "./shell/reveal-on-restore.js";
import { ScmContribution } from "@theia/scm/lib/browser/scm-contribution";
import { SpexrBootstrapContribution } from "./bootstrap/spexr-bootstrap-contribution.js";
import { SpexrThemeContribution } from "./theme/spexr-theme-contribution.js";
import { SpexrColorContribution } from "./theme/spexr-color-contribution.js";
import { ClaudeTerminalManager } from "./agent/claude-terminal-manager.js";
import {
  SpexrAgentServiceProxy,
  AGENT_SESSION_SERVICE_PATH,
} from "./agent/agent-service-proxy.js";
import { SpexrPreferenceContribution } from "./preferences/spexr-preferences.js";
import { PreferenceConfigurations } from "@theia/core/lib/common/preferences/preference-configurations";
import { SpexrPreferenceConfigurations } from "./preferences/spexr-preference-configurations.js";
import { SpexrLanguageGrammarContribution } from "./language/spexr-language-grammar-contribution.js";
import { LanguageGrammarDefinitionContribution } from "@theia/monaco/lib/browser/textmate/textmate-contribution.js";
import { AboutDialog } from "@theia/core/lib/browser/about-dialog.js";
import { SpexrAboutDialog } from "./about/spexr-about-dialog.js";
import { SpexrGitScmProvider } from "./scm/git-scm-provider.js";
import { GitIgnoredDecorationProvider } from "./scm/git-ignored-decoration-provider.js";
import { SpexrGitServiceProxySymbol, GIT_SERVICE_PATH } from "./scm/git-service-proxy.js";
import { SpexrGitClientDispatcher, SpexrGitClientToken } from "./scm/git-client.js";
import { SpexrGitCommandsContribution } from "./scm/git-commands-contribution.js";
import { SpexrGitToolbarContribution } from "./scm/git-toolbar-contribution.js";
import { GitStatusBarContribution } from "./scm/git-status-bar-contribution.js";
import { GitOriginalResourceResolver } from "./scm/git-original-resource.js";
import { ResourceResolver } from "@theia/core/lib/common/resource";
import { SpexrGitBlameDecorator } from "./blame/blame-decorator.js";
import { SpexrGitBlameCommandsContribution } from "./blame/blame-commands-contribution.js";
import {
  SpexrSmartSearchContribution,
  bindSmartSearchWidgetFactory,
} from "./search/smart-search-contribution.js";
import { SmartSearchWidget } from "./search/smart-search-widget.js";
import { SpexrSearchServiceProxy, SEARCH_SERVICE_PATH } from "./search/smart-search-service.js";
import { SpexrSearchClientDispatcher, SpexrSearchClientToken } from "./search/smart-search-client.js";
import { DescriptionJobStatusBarContribution } from "./search/description-job-status-bar-contribution.js";
import { SpexrDarkfactoryWidget } from "./darkfactory/darkfactory-wall-widget.js";
import { SpexrDarkfactoryViewContribution } from "./darkfactory/darkfactory-view-contribution.js";
import {
  SpexrDarkfactoryServiceProxy,
  DARKFACTORY_SERVICE_PATH,
} from "./darkfactory/darkfactory-service-proxy.js";
import {
  SpexrDarkfactoryClientDispatcher,
  SpexrDarkfactoryClientToken,
} from "./darkfactory/darkfactory-client.js";
import { SpexrDarkfactoryTerminalManager } from "./darkfactory/darkfactory-terminal-manager.js";

/**
 * Frontend contributions for SPEXR. Theia handles DI via Inversify and
 * discovers contributions through these bindings.
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
  bindViewContribution(bind, SpexrSpecViewContribution);
  bind(SpexrSpecWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: SPEC_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrSpecWidget),
    }))
    .inSingletonScope();

  bindViewContribution(bind, SpexrMemoryViewContribution);
  bind(SpexrMemoryWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: MEMORY_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrMemoryWidget),
    }))
    .inSingletonScope();

  bindViewContribution(bind, SpexrExpertsViewContribution);
  bind(SpexrExpertsWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: EXPERTS_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrExpertsWidget),
    }))
    .inSingletonScope();

  bindViewContribution(bind, SpexrSpecResourcesViewContribution);
  bind(SpexrSpecResourcesWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: SPEC_RESOURCES_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrSpecResourcesWidget),
    }))
    .inSingletonScope();
  bind(SpexrSpecResourcesVisibilityContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrSpecResourcesVisibilityContribution);

  bindViewContribution(bind, SpexrSpecLintViewContribution);
  bind(SpexrSpecLintWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: SPEC_LINT_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrSpecLintWidget),
    }))
    .inSingletonScope();
  bind(SpexrSpecLintVisibilityContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrSpecLintVisibilityContribution);

  bind(SpexrSpecPreviewWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: SPEC_PREVIEW_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrSpecPreviewWidget),
    }))
    .inSingletonScope();
  bind(SpexrSpecPreviewContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrSpecPreviewContribution);
  bind(CommandContribution).toService(SpexrSpecPreviewContribution);

  bindViewContribution(bind, SpexrWelcomeViewContribution);
  bind(SpexrWelcomeWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: WELCOME_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrWelcomeWidget),
    }))
    .inSingletonScope();

  bind(SpexrShellLayoutContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrShellLayoutContribution);
  // Views that must stay visible across Theia's Electron-wide shell-layout cache
  // (see reveal-on-restore.ts). Add future default-visible views here, not by
  // special-casing SpexrShellLayoutContribution.
  bind(SpexrRevealOnRestore).toService(SpexrExpertsViewContribution);
  bind(SpexrRevealOnRestore).toService(ScmContribution);
  bind(FrontendApplicationContribution).to(SpexrBootstrapContribution).inSingletonScope();
  bind(FrontendApplicationContribution).to(SpexrThemeContribution).inSingletonScope();
  bind(ColorContribution).to(SpexrColorContribution).inSingletonScope();

  bind(ClaudeTerminalManager).toSelf().inSingletonScope();

  bind(SpexrAgentServiceProxy)
    .toDynamicValue((ctx) => {
      const connection = ctx.container.get(WebSocketConnectionProvider);
      return connection.createProxy(AGENT_SESSION_SERVICE_PATH);
    })
    .inSingletonScope();

  bind(SpexrCommandsContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(SpexrCommandsContribution);
  bind(MenuContribution).toService(SpexrCommandsContribution);

  bind(SpexrSpecEditorToolbarContribution).toSelf().inSingletonScope();
  bind(TabBarToolbarContribution).toService(SpexrSpecEditorToolbarContribution);

  bind(SpexrAgentTerminalToolbarContribution).toSelf().inSingletonScope();
  bind(TabBarToolbarContribution).toService(SpexrAgentTerminalToolbarContribution);

  bind(SpexrSpecRelationsContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrSpecRelationsContribution);

  bind(SpexrSpecExternalReloadContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrSpecExternalReloadContribution);

  bind(SpexrPreferenceContribution).toSelf().inSingletonScope();
  bind(PreferenceContribution).toService(SpexrPreferenceContribution);

  bind(SpexrPreferenceConfigurations).toSelf().inSingletonScope();
  rebind(PreferenceConfigurations).toService(SpexrPreferenceConfigurations);

  bind(SpexrLanguageGrammarContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrLanguageGrammarContribution);
  bind(LanguageGrammarDefinitionContribution).toService(SpexrLanguageGrammarContribution);

  bind(SpexrAboutDialog).toSelf();
  rebind(AboutDialog).toService(SpexrAboutDialog);

  // --- Git SCM ---
  bind(SpexrGitClientDispatcher).toSelf().inSingletonScope();
  bind(SpexrGitClientToken).toService(SpexrGitClientDispatcher);
  bind(SpexrGitServiceProxySymbol)
    .toDynamicValue((ctx) => {
      const connection = ctx.container.get(WebSocketConnectionProvider);
      const client = ctx.container.get(SpexrGitClientDispatcher);
      return connection.createProxy(GIT_SERVICE_PATH, client);
    })
    .inSingletonScope();

  // Bound before SpexrGitScmProvider: FrontendApplicationContribution#onStart
  // runs in bind order, awaiting each one to completion, so this listener
  // must attach before the provider's own onStart fires its first refresh.
  bind(GitStatusBarContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(GitStatusBarContribution);

  bind(SpexrGitScmProvider).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrGitScmProvider);

  bind(GitIgnoredDecorationProvider).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(GitIgnoredDecorationProvider);

  bind(SpexrGitCommandsContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(SpexrGitCommandsContribution);
  bind(MenuContribution).toService(SpexrGitCommandsContribution);

  bind(SpexrGitToolbarContribution).toSelf().inSingletonScope();
  bind(TabBarToolbarContribution).toService(SpexrGitToolbarContribution);

  bind(GitOriginalResourceResolver).toSelf().inSingletonScope();
  bind(ResourceResolver).toService(GitOriginalResourceResolver);

  // --- Git blame ---
  bind(SpexrGitBlameDecorator).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrGitBlameDecorator);
  bind(SpexrGitBlameCommandsContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(SpexrGitBlameCommandsContribution);
  bind(KeybindingContribution).toService(SpexrGitBlameCommandsContribution);
  bind(MenuContribution).toService(SpexrGitBlameCommandsContribution);

  // --- Smart Search ---
  bind(SpexrSearchClientDispatcher).toSelf().inSingletonScope();
  bind(SpexrSearchClientToken).toService(SpexrSearchClientDispatcher);
  bind(SpexrSearchServiceProxy)
    .toDynamicValue((ctx) => {
      const connection = ctx.container.get(WebSocketConnectionProvider);
      const client = ctx.container.get(SpexrSearchClientDispatcher);
      return connection.createProxy(SEARCH_SERVICE_PATH, client);
    })
    .inSingletonScope();
  bindSmartSearchWidgetFactory(bind);
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: SmartSearchWidget.ID,
      createWidget: () => ctx.container.get(SmartSearchWidget),
    }))
    .inSingletonScope();
  bind(SpexrSmartSearchContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrSmartSearchContribution);
  bind(CommandContribution).toService(SpexrSmartSearchContribution);
  bind(DescriptionJobStatusBarContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(DescriptionJobStatusBarContribution);

  // --- Darkfactory ---
  bindViewContribution(bind, SpexrDarkfactoryViewContribution);
  // Default-visible tab, pinned alongside Welcome/Specs/Agent across Theia's
  // Electron-wide shell-layout cache (see reveal-on-restore.ts).
  bind(SpexrRevealOnRestore).toService(SpexrDarkfactoryViewContribution);
  bind(SpexrDarkfactoryWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: SpexrDarkfactoryWidget.ID,
      createWidget: () => ctx.container.get(SpexrDarkfactoryWidget),
    }))
    .inSingletonScope();
  bind(SpexrDarkfactoryTerminalManager).toSelf().inSingletonScope();
  bind(SpexrDarkfactoryClientDispatcher).toSelf().inSingletonScope();
  bind(SpexrDarkfactoryClientToken).toService(SpexrDarkfactoryClientDispatcher);
  bind(SpexrDarkfactoryServiceProxy)
    .toDynamicValue((ctx) => {
      const connection = ctx.container.get(WebSocketConnectionProvider);
      const client = ctx.container.get(SpexrDarkfactoryClientDispatcher);
      return connection.createProxy(DARKFACTORY_SERVICE_PATH, client);
    })
    .inSingletonScope();
});
