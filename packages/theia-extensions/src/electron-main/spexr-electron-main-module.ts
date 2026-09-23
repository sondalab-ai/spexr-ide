import { ContainerModule } from "@theia/core/shared/inversify";
import {
  ElectronMainApplication,
  ElectronMainApplicationContribution,
} from "@theia/core/lib/electron-main/electron-main-application";
import { SpexrElectronMainContribution } from "./spexr-electron-main-contribution.js";
import { SpexrElectronMainApplication } from "./spexr-electron-main-application.js";

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
  bind(ElectronMainApplicationContribution).to(SpexrElectronMainContribution).inSingletonScope();
  rebind(ElectronMainApplication).to(SpexrElectronMainApplication).inSingletonScope();
});
