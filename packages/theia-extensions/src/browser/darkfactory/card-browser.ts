import type { SessionLink } from "../../common/darkfactory-protocol.js";

/** A page the browser was asked to load; a new `seq` reloads even the same URL. */
export interface BrowserRequest {
  readonly url: string;
  readonly seq: number;
}

/**
 * A pinned card's browser (spec 0016): whether it is open, the page it was
 * last asked to load, and whether it follows the session's links.
 */
export interface CardBrowserState {
  readonly open: boolean;
  readonly request?: BrowserRequest;
  /** True until the user types an address; picking a session link restores it. */
  readonly following: boolean;
  /** The newest session link already acted on, so a refresh with nothing new is a no-op. */
  readonly followed?: string;
}

export const CLOSED_BROWSER: CardBrowserState = { open: false, following: true };

function request(state: CardBrowserState, url: string): BrowserRequest {
  return { url, seq: (state.request?.seq ?? 0) + 1 };
}

/** Open the pane: back on the page it showed, or on the session's newest link. */
export function openBrowser(state: CardBrowserState, links: readonly SessionLink[]): CardBrowserState {
  if (state.request) return { ...state, open: true };
  const newest = links[0];
  return newest
    ? { ...state, open: true, request: request(state, newest.url), followed: newest.url }
    : { ...state, open: true };
}

export function closeBrowser(state: CardBrowserState): CardBrowserState {
  return { ...state, open: false };
}

/**
 * React to a refreshed list of session links. While following, a newest link
 * not yet acted on replaces the page; otherwise the state is returned as is,
 * so callers can skip a re-render.
 */
export function applyLinks(state: CardBrowserState, links: readonly SessionLink[]): CardBrowserState {
  const newest = links[0];
  if (!state.open || !state.following || !newest || newest.url === state.followed) return state;
  return { ...state, request: request(state, newest.url), followed: newest.url };
}

/**
 * Load a page the user asked for. A typed address stops following the
 * session; picking one of the session's links resumes it.
 */
export function navigateBrowser(
  state: CardBrowserState,
  url: string,
  how: "typed" | "picked",
): CardBrowserState {
  return how === "typed"
    ? { ...state, open: true, request: request(state, url), following: false }
    : { ...state, open: true, request: request(state, url), following: true, followed: url };
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i;
const HOST = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/;

/**
 * Turn what the user typed into a web URL: kept when it already is one, given
 * `http://` for a local host and `https://` for any other bare host. Anything
 * else (another scheme, plain words) is refused.
 */
export function normalizeAddress(input: string): string | undefined {
  const text = input.trim();
  if (text === "") return undefined;
  if (/^https?:\/\//i.test(text)) return text;
  if (LOOPBACK.test(text)) return `http://${text}`;
  if (HOST.test(text)) return `https://${text}`;
  return undefined;
}

/** Storage key for the share of a card's body the terminal keeps above the browser. */
export const SPLIT_KEY = "spexr.darkfactory.browserSplit";
const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.8;
const DEFAULT_SPLIT = 0.5;

/** The slice of `localStorage` this module needs, so tests can pass a fake. */
export interface SplitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function clampSplit(ratio: number): number {
  return Math.min(Math.max(ratio, MIN_SPLIT), MAX_SPLIT);
}

/** The remembered split, one value for every card, like the card height. */
export function readSplitRatio(storage: SplitStorage): number {
  try {
    const raw = storage.getItem(SPLIT_KEY);
    const parsed = Number(raw);
    return raw !== null && Number.isFinite(parsed) ? clampSplit(parsed) : DEFAULT_SPLIT;
  } catch {
    return DEFAULT_SPLIT; // blocked site data throws on access
  }
}

export function writeSplitRatio(storage: SplitStorage, ratio: number): void {
  try {
    storage.setItem(SPLIT_KEY, String(Math.round(clampSplit(ratio) * 1000) / 1000));
  } catch {
    // ignore: the split still applies for this session
  }
}
