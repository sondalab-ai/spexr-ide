import * as React from "react";
import { injectable } from "@theia/core/shared/inversify";
import { AboutDialog } from "@theia/core/lib/browser/about-dialog.js";

const GITHUB_URL = "https://github.com/sondalab-ai/spexr-ide";
const ISSUES_URL = "https://github.com/sondalab-ai/spexr-ide/issues/new";

@injectable()
export class SpexrAboutDialog extends AboutDialog {
  protected override renderHeader(): React.ReactNode {
    const version = this.applicationInfo?.version;
    return (
      <>
        <div className="spexr-about-header">
          <span className="spexr-about-title">
            SPEXR{version ? <span className="spexr-about-version">&nbsp;v{version}</span> : null}
          </span>
          <p className="spexr-about-tagline">
            AI-powered spec editor. Write specs, validate them live, ship with
            confidence.
          </p>
          <div className="spexr-about-links">
            <a
              role="button"
              tabIndex={0}
              onClick={(e) => { e.preventDefault(); this.doOpenExternalLink(GITHUB_URL); }}
              onKeyDown={(e) => this.doOpenExternalLinkEnter(e, GITHUB_URL)}
            >
              GitHub
            </a>
            <span aria-hidden>·</span>
            <a
              role="button"
              tabIndex={0}
              onClick={(e) => { e.preventDefault(); this.doOpenExternalLink(ISSUES_URL); }}
              onKeyDown={(e) => this.doOpenExternalLinkEnter(e, ISSUES_URL)}
            >
              Report Issue
            </a>
          </div>
        </div>
        {super.renderHeader()}
      </>
    );
  }
}
