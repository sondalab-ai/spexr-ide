import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import type URI from "@theia/core/lib/common/uri";
import type { CancellationToken } from "@theia/core";
import type { Decoration } from "@theia/core/lib/browser/decorations-service";
import { ProblemDecorationsProvider } from "@theia/markers/lib/browser/problem/problem-decorations-provider";
import { gateProblemDecoration } from "./problem-decoration-gate.js";
import { ProblemPreferences } from "@theia/markers/lib/common/problem-preferences";

/**
 * Theia's problem marks on files and folders, honouring
 * `problems.decorations.enabled` (S6b, L7).
 *
 * Theia 1.75 draws them through the decorations service (a count as the
 * letter, bubbling a dot up to every folder), and checks the preference only
 * in its older tree decorator, so turning the preference off left the marks
 * in place. Lumen's Explorer shows git's letters alone, and the default
 * preference is off (apps/desktop/package.json). That default is spexr's
 * own, not Theia's (Theia's is on): a user who wants the marks back turns the
 * preference on, and they return.
 */
@injectable()
export class SpexrProblemDecorationsProvider extends ProblemDecorationsProvider {
  @inject(ProblemPreferences)
  private readonly problemPreferences!: ProblemPreferences;

  @postConstruct()
  protected initPreference(): void {
    this.problemPreferences.onPreferenceChanged((event) => {
      if (event.preferenceName === "problems.decorations.enabled") this.doFireDidDecorationsChanged();
    });
  }

  override provideDecorations(uri: URI, token: CancellationToken): Decoration | Promise<Decoration | undefined> | undefined {
    return gateProblemDecoration(this.problemPreferences["problems.decorations.enabled"], () => super.provideDecorations(uri, token));
  }
}
