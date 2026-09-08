import { injectable, inject } from "@theia/core/shared/inversify";
import { CommandRegistry } from "@theia/core/lib/common/command";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import type {
  PreferenceContribution,
  PreferenceSchemaService,
} from "@theia/core/lib/common/preferences/preference-schema";
import {
  HIDDEN_AI_PREFERENCE_IDS,
  registeredAiCommandsToHide,
  staleAiCommandIds,
} from "./ai-surface-curation.js";

/**
 * Removes Theia's own AI commands and preferences from SPEXR's UI.
 *
 * They arrive transitively through `@theia/plugin-ext`; see
 * ai-surface-curation.ts for what is hidden and why.
 */
@injectable()
export class SpexrAiSurfaceCurationContribution
  implements FrontendApplicationContribution, PreferenceContribution
{
  @inject(CommandRegistry)
  private readonly commands!: CommandRegistry;

  /**
   * Unregisters the AI commands once every contribution has registered its own.
   *
   * `onStart` rather than a `CommandContribution`: contribution order across
   * packages is not guaranteed, and unregistering a command that a later
   * contribution has yet to register would silently do nothing.
   */
  onStart(): void {
    for (const id of registeredAiCommandsToHide(this.commands.commandIds)) {
      this.commands.unregisterCommand(id);
    }
    const stale = staleAiCommandIds(this.commands.commandIds);
    if (stale.length > 0) {
      console.warn(
        `SPEXR AI surface curation: no longer registered, review after a Theia upgrade — ${stale.join(", ")}`,
      );
    }
  }

  /**
   * Hides the AI preference placeholder from the Settings UI.
   *
   * Stays subscribed the way Theia's own `HideAiPreferencesContribution` does:
   * a schema contributed after this point would otherwise remain visible. The
   * schema itself stays registered, so validation is unaffected.
   */
  async initSchema(service: PreferenceSchemaService): Promise<void> {
    this.hide(service);
    // Never disposed on purpose: this contribution lives as long as the application.
    service.onDidChangeSchema(() => this.hide(service));
  }

  /**
   * Turns on `hidden` for each preference in the list that is not hidden yet.
   *
   * Idempotent, and the `hidden` check is what stops the `onDidChangeSchema`
   * subscription from re-entering: `updateSchemaProperty` fires that event
   * synchronously.
   */
  private hide(service: PreferenceSchemaService): void {
    const properties = service.getSchemaProperties();
    for (const id of HIDDEN_AI_PREFERENCE_IDS) {
      const property = properties.get(id);
      if (property && !property.hidden) {
        service.updateSchemaProperty(id, { ...property, hidden: true });
      }
    }
  }
}
