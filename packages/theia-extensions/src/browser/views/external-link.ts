/**
 * Anchors rendered from changelog markdown are opened by Electron through
 * `shell.openExternal`, and that markdown is now fetched at runtime rather than
 * bundled. Only plain `https:` URLs are allowed through; everything else
 * (`javascript:`, `file:`, malformed input) is rejected so the caller can fall
 * back to plain text.
 */
export function httpsHref(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
