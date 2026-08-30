import type URI from "@theia/core/lib/common/uri";

const MARKDOWN_FILE_RE = /\.(?:md|markdown)$/i;

/**
 * True for any markdown file name, by extension. This is the preview's scope:
 * the preview renders whatever markdown the user is editing, while the narrower
 * spec naming rule (`NNNN-slug.md` under a specs directory) still governs which
 * files open the preview by themselves.
 */
export function isMarkdownPath(base: string): boolean {
  return MARKDOWN_FILE_RE.test(base);
}

/**
 * {@link isMarkdownPath} for a resource URI; false when there is no URI.
 * Narrows the URI so callers can read it straight after the check.
 */
export function isMarkdownUri(uri: URI | undefined): uri is URI {
  return uri !== undefined && isMarkdownPath(uri.path.base);
}
