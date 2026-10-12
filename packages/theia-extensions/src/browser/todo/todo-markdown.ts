import { Marked } from "marked";
import { httpsHref } from "../views/external-link.js";
import type { TodoItem } from "./todo-list.js";

/** Past this many characters an item's text is folded to a few lines. */
const FOLD_CHARS = 140;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A Markdown renderer for TODO text, which is typed by hand or pasted. Raw HTML
 * and images are shown as text, and only `https:` links stay links, so the
 * result is safe to inject without a sanitizer.
 */
const md = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    image: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      const safe = httpsHref(href);
      return safe ? `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">${inner}</a>` : inner;
    },
  },
});

/** An item's whole text: its checkbox line and the lines under it, as one paragraph run. */
export function todoBody(item: Pick<TodoItem, "title" | "details">): string {
  return item.details ? `${item.title}\n${item.details}` : item.title;
}

/** Whether the item is worth folding: long, or carrying list, quote or code lines. */
export function isFoldable(item: Pick<TodoItem, "title" | "details">): boolean {
  return todoBody(item).length > FOLD_CHARS || /^\s*([-*+]\s|\d+[.)]\s|>|```)/m.test(item.details);
}

/** The text as inline Markdown (bold, code, links), for the folded view. */
export function renderInline(text: string): string {
  return md.parseInline(text.replace(/\s*\n\s*/g, " ")) as string;
}

/** The text as full Markdown (paragraphs, lists, code blocks), for the unfolded view. */
export function renderBlock(text: string): string {
  return md.parse(text) as string;
}
