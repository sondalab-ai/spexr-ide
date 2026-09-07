import { injectable, inject } from "@theia/core/shared/inversify";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { PreferenceScope } from "@theia/core/lib/common/preferences/preference-scope";
import { SpexrAgentServiceProxy } from "./agent-service-proxy.js";
import type { SpexrAgentService } from "../../common/agent-protocol.js";
import {
  mergeLaunchProfiles,
  parseLaunchProfiles,
  type ClaudeLaunchProfile,
} from "../../common/claude-launch-profiles.js";
import { SPEXR_CLAUDE_LAUNCH_PROFILES_PREFERENCE } from "../preferences/spexr-preferences.js";

/** What a detection run changed, so callers can report it in their own words. */
export interface LaunchProfileDetection {
  /** Profiles written to the preference by this run. */
  readonly added: readonly ClaudeLaunchProfile[];
  /** Everything the shell configuration offered, including already-configured accounts. */
  readonly detected: readonly ClaudeLaunchProfile[];
}

/**
 * Fills the launch-profiles preference in from the user's shell aliases.
 *
 * Shared by the manual command and the one-shot run at startup, so both write
 * the same way: an account the user has already configured is never touched,
 * and only accounts with no profile yet gain one.
 */
@injectable()
export class SpexrLaunchProfilesService {
  @inject(SpexrAgentServiceProxy)
  private readonly agentService!: SpexrAgentService | undefined;

  @inject(PreferenceService)
  private readonly preferences!: PreferenceService;

  /**
   * Detect and persist. Throws when the backend is unreachable, so callers can
   * tell "nothing to add" apart from "could not look".
   */
  async detect(): Promise<LaunchProfileDetection> {
    if (!this.agentService) throw new Error("agent backend service unavailable");

    const configured = parseLaunchProfiles(
      this.preferences.get<unknown>(SPEXR_CLAUDE_LAUNCH_PROFILES_PREFERENCE),
    );
    const detected = await this.agentService.detectLaunchProfiles();
    const merged = mergeLaunchProfiles(configured, detected);
    const added = merged.slice(configured.length);
    if (added.length === 0) return { added, detected };

    // User scope: shell aliases belong to the machine, not to one project.
    await this.preferences.set(
      SPEXR_CLAUDE_LAUNCH_PROFILES_PREFERENCE,
      merged,
      PreferenceScope.User,
    );
    return { added, detected };
  }
}
