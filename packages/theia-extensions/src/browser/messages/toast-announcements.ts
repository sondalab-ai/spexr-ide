/** A notification as the announcer reads it (Theia's Notification, @theia/messages). */
export interface ToastNote {
  readonly messageId: string;
  readonly type: "info" | "warning" | "error" | "progress";
  /** Theia's rendered message: HTML. */
  readonly message: string;
}

/** What NotificationManager.onUpdated hands the announcer. */
export interface ToastUpdate {
  readonly notifications: readonly Pick<ToastNote, "messageId">[];
  readonly toasts: readonly ToastNote[];
  readonly visibilityState: "hidden" | "toasts" | "center";
}

/** One thing to say: in the alert region for an error, the polite one otherwise. */
export interface Announcement {
  readonly messageId: string;
  readonly region: "polite" | "alert";
  readonly text: string;
}

/** The words a severity is announced with: the tone a sighted user reads off the glyph. */
const PREFIX: Record<ToastNote["type"], string> = { info: "", progress: "", warning: "Warning: ", error: "Error: " };

/**
 * What to announce for an update of Theia's notifications, and the ids
 * announced so far. Each toast is announced once, the first time it shows,
 * so a progress toast's updates are not read again. Nothing is announced
 * while the toasts are not showing (the center is open, or they are
 * hidden) or notifications are silent, and those toasts count as seen, so
 * they are not read out later. Ids that have left the notifications are
 * dropped from the seen set. `plain` turns Theia's message HTML into text.
 */
export function toastAnnouncements(
  update: ToastUpdate,
  seen: ReadonlySet<string>,
  silent: boolean,
  plain: (html: string) => string,
): { announce: Announcement[]; seen: Set<string> } {
  const live = new Set([...update.notifications, ...update.toasts].map((n) => n.messageId));
  const next = new Set([...seen].filter((id) => live.has(id)));
  const speak = !silent && update.visibilityState === "toasts";
  const announce: Announcement[] = [];
  for (const toast of update.toasts) {
    if (next.has(toast.messageId)) continue;
    next.add(toast.messageId);
    const text = plain(toast.message).replace(/\s+/g, " ").trim();
    if (speak && text) {
      announce.push({ messageId: toast.messageId, region: toast.type === "error" ? "alert" : "polite", text: PREFIX[toast.type] + text });
    }
  }
  return { announce, seen: next };
}
