/** A notification as the announcer reads it (Theia's Notification, @theia/messages). */
export interface ToastNote {
  readonly messageId: string;
  readonly type: "info" | "warning" | "error" | "progress";
  /** Theia's rendered message: HTML. */
  readonly message: string;
}

/** What the announcer reads of a NotificationManager update. */
export interface ToastUpdate {
  readonly toasts: readonly ToastNote[];
  readonly visibilityState: "hidden" | "toasts" | "center";
}

/** One thing to say: in the alert region for an error, the polite one otherwise. */
export interface Announcement {
  readonly messageId: string;
  readonly region: "polite" | "alert";
  readonly text: string;
}

/** How many toasts Theia shows at once: NotificationToastsComponent renders `toasts.slice(-3)`. */
export const TOASTS_SHOWN = 3;

/** The longest announcement, in characters; a longer message ends in an ellipsis. */
export const ANNOUNCEMENT_MAX = 1000;

/** The words a severity is announced with: the tone a sighted user reads off the glyph. */
const PREFIX: Record<ToastNote["type"], string> = { info: "", progress: "", warning: "Warning: ", error: "Error: " };

/**
 * What to announce for an update of Theia's notifications, and the toasts
 * it shows. A toast is announced when it newly appears among the toasts on
 * screen: the last TOASTS_SHOWN, while the toasts are showing and
 * notifications are not silent. Theia names a message by a hash of its type,
 * text and actions, so the same message twice has the same id: it is
 * announced again once it has left the screen (it timed out, and stays in the
 * center) and comes back. A progress toast's updates keep it on screen, so
 * they are not read again. `plain` turns Theia's message HTML into text.
 */
export function toastAnnouncements(
  update: ToastUpdate,
  shownBefore: ReadonlySet<string>,
  silent: boolean,
  plain: (html: string) => string,
): { announce: Announcement[]; shown: Set<string> } {
  if (silent || update.visibilityState !== "toasts") return { announce: [], shown: new Set() };
  const onScreen = update.toasts.slice(-TOASTS_SHOWN);
  const announce = onScreen.flatMap((toast): Announcement[] => {
    if (shownBefore.has(toast.messageId)) return [];
    let text = plain(toast.message).replace(/\s+/g, " ").trim();
    if (!text) return [];
    if (text.length > ANNOUNCEMENT_MAX) text = `${text.slice(0, ANNOUNCEMENT_MAX - 1).trimEnd()}…`;
    return [{ messageId: toast.messageId, region: toast.type === "error" ? "alert" : "polite", text: PREFIX[toast.type] + text }];
  });
  return { announce, shown: new Set(onScreen.map((toast) => toast.messageId)) };
}

/** The part of a DOM node flattenText reads. */
export interface TextNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly textContent: string | null;
  readonly childNodes: ArrayLike<TextNode>;
}

/** Elements that end a line: their text is set apart from their neighbours'. */
const BLOCK = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DD|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TBODY|TD|TH|THEAD|TR|UL)$/;

/**
 * A message's text, from its parsed HTML: the text nodes in order, with a
 * space around every block element, so "<p>Saved</p><p>3 files</p>" reads
 * "Saved 3 files", not "Saved3 files" (textContent alone joins them).
 */
export function flattenText(node: TextNode): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  const inner = Array.from(node.childNodes, flattenText).join("");
  return BLOCK.test(node.nodeName.toUpperCase()) ? ` ${inner} ` : inner;
}
