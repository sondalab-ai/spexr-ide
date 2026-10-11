import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { CorePreferences } from "@theia/core/lib/common/core-preferences";
import { NotificationManager } from "@theia/messages/lib/browser/notifications-manager";
import { flattenText, toastAnnouncements, type Announcement } from "./toast-announcements.js";

/** How long an announcement stays in its region after it is read. */
const ANNOUNCEMENT_MS = 5_000;

/** A message's text, from Theia's (sanitised) HTML: an inert document, nothing runs. */
function plainText(html: string): string {
  return flattenText(new DOMParser().parseFromString(html, "text/html").body);
}

/**
 * Announces Theia's toasts to assistive technology (the kit's toast stack,
 * 0.33: a polite region for every toast, an alert one for a toast that must
 * interrupt). Theia renders a toast with no role and no live region, and its
 * container is display: none while closed, so a region there would drop out
 * of the accessibility tree. Two sibling regions, visually hidden, exist
 * from start, before the first toast. A toast is said when it newly appears
 * on screen (toastAnnouncements), as plain text, an error in the alert
 * region and everything else in the polite one, and each announcement leaves
 * its region a few seconds later.
 */
@injectable()
export class SpexrToastAnnouncer implements FrontendApplicationContribution {
  @inject(NotificationManager) private readonly notifications!: NotificationManager;
  @inject(CorePreferences) private readonly preferences!: CorePreferences;

  /** The toasts on screen at the last update. */
  private shown: Set<string> = new Set();
  private regions: Record<Announcement["region"], HTMLElement> | undefined;

  onStart(): void {
    const polite = document.createElement("div");
    polite.className = "spexr-sr-only";
    polite.setAttribute("aria-live", "polite");
    const alert = document.createElement("div");
    alert.className = "spexr-sr-only";
    alert.setAttribute("role", "alert");
    document.body.append(polite, alert);
    this.regions = { polite, alert };
    this.notifications.onUpdated((update) => {
      const { announce, shown } = toastAnnouncements(update, this.shown, !!this.preferences["workbench.silentNotifications"], plainText);
      this.shown = shown;
      announce.forEach((announcement) => this.say(announcement));
    });
  }

  private say(announcement: Announcement): void {
    const region = this.regions?.[announcement.region];
    if (!region) return;
    const line = document.createElement("p");
    line.textContent = announcement.text;
    region.append(line);
    setTimeout(() => line.remove(), ANNOUNCEMENT_MS);
  }
}
