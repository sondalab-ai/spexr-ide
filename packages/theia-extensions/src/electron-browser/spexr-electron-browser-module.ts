import { ContainerModule } from "@theia/core/shared/inversify";
import { PreferenceContribution } from "@theia/core/lib/common/preferences/preference-schema";
import { ElectronMenuContribution } from "@theia/core/lib/electron-browser/menu/electron-menu-contribution";
import { SpexrTitleBarWidget } from "../browser/titlebar/spexr-titlebar-widget.js";
import { SpexrElectronMenuContribution } from "./spexr-electron-menu-contribution.js";
import { SpexrTitleBarPreferenceContribution } from "./title-bar-preference-contribution.js";

/**
 * spexr's Electron-only frontend bindings, loaded after the browser module
 * (package.json theiaExtensions, a second entry: Theia takes an entry's
 * `frontendElectron` in place of its `frontend`, so they cannot share one).
 * Theia's core Electron menu module is loaded before every extension, so the
 * contribution is always bound here; every service Theia binds to it
 * (FrontendApplicationContribution, CommandContribution, MenuContribution,
 * KeybindingContribution) resolves through it and so reaches the subclass.
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
  bind(SpexrTitleBarWidget).toSelf().inSingletonScope();
  rebind(ElectronMenuContribution).to(SpexrElectronMenuContribution).inSingletonScope();
  bind(SpexrTitleBarPreferenceContribution).toSelf().inSingletonScope();
  bind(PreferenceContribution).toService(SpexrTitleBarPreferenceContribution);
});
