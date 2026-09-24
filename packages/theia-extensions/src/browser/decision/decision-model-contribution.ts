import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import {
  DEFAULT_DECISION_MODEL,
  isDecisionModel,
  type SpexrDecisionService,
} from "../../common/decision-protocol.js";
import { SPEXR_DECISIONS_MODEL_PREFERENCE } from "../preferences/spexr-preferences.js";
import { SpexrDecisionServiceProxy } from "./decision-service-proxy.js";

/**
 * Carries the decision-model preference to the backend, which owns the model
 * process and cannot read preferences itself. Pushed on start and on change;
 * the backend ignores a push that changes nothing.
 */
@injectable()
export class SpexrDecisionModelContribution implements FrontendApplicationContribution {
  @inject(PreferenceService) private readonly preferences!: PreferenceService;
  @inject(SpexrDecisionServiceProxy) private readonly service!: SpexrDecisionService;

  onStart(): void {
    void this.preferences.ready.then(() => {
      this.push();
      this.preferences.onPreferenceChanged((e) => {
        if (e.preferenceName === SPEXR_DECISIONS_MODEL_PREFERENCE) this.push();
      });
    });
  }

  private push(): void {
    const value = this.preferences.get<string>(SPEXR_DECISIONS_MODEL_PREFERENCE);
    const model = isDecisionModel(value) ? value : DEFAULT_DECISION_MODEL;
    void this.service.setModel(model).catch((err) => {
      console.error("[spexr] could not apply the decision model preference", err);
    });
  }
}
