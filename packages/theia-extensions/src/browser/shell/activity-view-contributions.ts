import { injectable } from "@theia/core/shared/inversify";
import { DebugFrontendApplicationContribution } from "@theia/debug/lib/browser/debug-frontend-application-contribution";
import { VSXExtensionsContribution } from "@theia/vsx-registry/lib/browser/vsx-extensions-contribution";

/**
 * Debug without its place in a fresh layout (S6d, A2, D13): Theia opens the
 * view in `initializeLayout`. Everything else is Theia's, so the view, its
 * commands and its menu entry still work.
 */
@injectable()
export class SpexrDebugContribution extends DebugFrontendApplicationContribution {
  override async initializeLayout(): Promise<void> {}
}

/** Extensions without its place in a fresh layout (S6d, A2, D13), as {@link SpexrDebugContribution}. */
@injectable()
export class SpexrExtensionsContribution extends VSXExtensionsContribution {
  override async initializeLayout(): Promise<void> {}
}
