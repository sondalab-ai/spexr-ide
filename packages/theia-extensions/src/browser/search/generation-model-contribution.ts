import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import type { SpexrSearchService } from "../../common/search-protocol.js";
import {
  coerceDtype,
  DEFAULT_GENERATION_MODEL,
  type GenerationModelConfig,
} from "../../common/generation-model.js";
import {
  SPEXR_SEARCH_GEN_DTYPE_PREFERENCE,
  SPEXR_SEARCH_GEN_MODEL_PREFERENCE,
} from "../preferences/spexr-preferences.js";
import { SpexrSearchServiceProxy } from "./smart-search-service.js";

/**
 * Carries the generation-model preference to the backend, which owns the model
 * worker and cannot read preferences itself.
 *
 * Pushed on start and on every change; the backend compares against what its
 * worker is actually running, so a redundant push costs nothing and a push that
 * races a starting worker still takes effect.
 */
@injectable()
export class SpexrGenerationModelContribution implements FrontendApplicationContribution {
  @inject(PreferenceService)
  private readonly preferences!: PreferenceService;

  @inject(SpexrSearchServiceProxy)
  private readonly service!: SpexrSearchService;

  onStart(): void {
    void this.preferences.ready.then(() => {
      this.push();
      this.preferences.onPreferenceChanged((e) => {
        if (
          e.preferenceName === SPEXR_SEARCH_GEN_MODEL_PREFERENCE ||
          e.preferenceName === SPEXR_SEARCH_GEN_DTYPE_PREFERENCE
        ) {
          this.push();
        }
      });
    });
  }

  private push(): void {
    void this.service.setGenerationModel(this.current()).catch((err) => {
      console.error("[spexr] could not apply the generation model preference", err);
    });
  }

  /** An empty id means the vendored default, so a cleared preference restores it. */
  private current(): GenerationModelConfig {
    const id = this.preferences.get<string>(SPEXR_SEARCH_GEN_MODEL_PREFERENCE, "")?.trim();
    return {
      id: id && id.length > 0 ? id : DEFAULT_GENERATION_MODEL.id,
      dtype: coerceDtype(this.preferences.get<string>(SPEXR_SEARCH_GEN_DTYPE_PREFERENCE)),
    };
  }
}
