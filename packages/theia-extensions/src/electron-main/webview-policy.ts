/**
 * Security policy for the `<webview>` guests the Darkfactory card browser
 * embeds (spec 0016). Kept free of Electron imports so it is unit-testable.
 */

/** Whether a guest may navigate to, or open, this URL: web pages only. */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Harden a guest's preferences before Electron attaches it, in place, as
 * `will-attach-webview` expects. Returns `false` when the guest must not be
 * attached at all (a source that is not a web page). Whatever the page asked
 * for, the guest gets no preload script and no Node, and runs sandboxed and
 * context-isolated: it shows remote content inside the app.
 */
export function hardenWebviewAttach(
  webPreferences: Record<string, unknown>,
  params: { readonly src?: string },
): boolean {
  const src = params.src ?? "";
  if (src !== "" && src !== "about:blank" && !isWebUrl(src)) return false;
  delete webPreferences["preload"];
  delete webPreferences["preloadURL"];
  webPreferences["nodeIntegration"] = false;
  webPreferences["nodeIntegrationInSubFrames"] = false;
  webPreferences["contextIsolation"] = true;
  webPreferences["sandbox"] = true;
  webPreferences["webSecurity"] = true;
  return true;
}
