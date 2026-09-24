---
slug: 0016-card-browser
title: Card browser — watch what a pinned session is doing on the web
status: draft
createdAt: 2026-09-23
workflowStep: plan
---
> **What is this file.** Implementation contract for an embedded browser in the
> Darkfactory pinned card, opened by a dedicated button, which follows the web
> pages a session produces (a pull request it opened, a local dev server it
> started). Audience: SPEXR contributors. Owner: marcello.barile. Companion
> files: `docs/specs/0011-darkfactory.md` (the wall and its pinned cards).
> Design choices recorded here were agreed in chat on 2026-09-23 (follow the
> session, split inside the card, terminal above and browser below, Electron
> `<webview>`, links detected from the transcript).

## Goal

A pinned card shows what a session types and prints, but not what it does on
the web. When an agent opens a pull request or starts a dev server, the user
leaves SPEXR to look at it, and has to find the URL in the scrollback first.

The card gets a **Browser** switch. It splits the card body: the terminal (or
the read-only live view) stays on top, a browser opens below. The browser
starts on the newest link the session produced and follows the session as new
ones appear; the user can pick another link the session produced, type an
address, or open the page in the system browser.

## Constraints found in the code

- `@theia/mini-browser` is not installed, and Electron's `<webview>` tag is off
  (Electron's default; nothing sets `webviewTag`).
- GitHub refuses to be framed (`X-Frame-Options: deny`, CSP
  `frame-ancestors 'none'`), so a plain `<iframe>` cannot show a pull request.
- Theia's `ElectronMainApplication.onWebContentsCreated` blocks **every**
  in-page navigation (`will-navigate` → `preventDefault`) and routes every popup
  to the system browser, for every web contents in the app, which includes any
  `<webview>` guest.
- Theia's `getDefaultOptions()` spreads `electron.windowOptions` from the
  application config at the top level, so setting `webPreferences` there would
  replace Theia's whole `webPreferences` object (dropping `contextIsolation`).
- Nothing detects URLs yet. Interactive cards receive no transcript events;
  only read-only cards run a follow.
- Opencode sessions have no transcript file.

## Design

### Embedding: Electron `<webview>`

A `<webview>` is a separate guest page with its own process, so it loads
GitHub and survives page scripts, and it lives in the DOM, so it clips,
scrolls and resizes with the card. The alternatives were rejected: an iframe
cannot show GitHub; a `WebContentsView` paints above the DOM, ignores the
wall's scrolling and overlays, and needs its bounds pushed over IPC on every
layout change.

Electron main (`packages/theia-extensions/src/electron-main`):
- A subclass of `ElectronMainApplication`, rebound in SPEXR's electron-main
  module, adds `webviewTag: true` to the window's default `webPreferences`,
  keeping every other default.
- `will-attach-webview` on the window hardens every guest before it exists:
  no preload, `nodeIntegration: false`, `contextIsolation: true`,
  `sandbox: true`, and only `http:`, `https:` and `about:blank` sources.
- Guest web contents (`getType() === "webview"`) are exempted from Theia's
  navigation block: in-page navigation is allowed for `http(s)` URLs; popups
  (`target=_blank`, `window.open`) load in the same guest for `http(s)` URLs
  and are denied otherwise. Every other web contents keeps Theia's policy.
- Guests share the persistent partition `persist:spexr-card-browser`, so
  signing in to GitHub once holds for every card and across restarts.

### Links a session produced

A backend method `listSessionLinks(sessionId)` returns the links found in the
session's transcript, newest first, deduplicated by URL:
- **pull requests**: `https://github.com/<owner>/<repo>/pull/<n>`, labelled
  `PR #<n> · <repo>`;
- **local servers**: `http(s)://localhost:<port>`, `127.0.0.1` and `0.0.0.0`
  (normalised to `localhost`), labelled `localhost:<port>`.

It scans tool results and assistant text, where `gh pr create` and dev
servers print their URLs. Extraction is a pure function with its own tests.
Reading follows the incremental follow reader: the first call reads the last
2 MB of the transcript, later calls only what was appended, so a long session
is never re-read whole. Opencode sessions and launched cards not yet adopted
return no links.

### The card

- A **Browser** toggle in the card's actions row (`codicon-globe`), on pinned
  and launched cards.
- When open, the body splits vertically: the existing body above, a drag
  divider, the browser below. The split ratio is remembered in `localStorage`
  (one value for all cards, like the card height), bounded to 20–80 %.
- Browser toolbar: back, forward, reload; an address field (Enter navigates;
  a bare host gets `https://`); a picker of the session's links; an
  open-in-system-browser button.
- Opening starts on the newest session link, or an empty page saying the
  session has produced no link yet.
- **Following**: while the user has not typed an address, a newly detected
  link replaces the page. Typing an address stops following for that card;
  choosing a session link from the picker resumes it. In-page clicks do not
  stop following.
- Links are refreshed when the pane opens and on every wall push while it is
  open (the wall is pushed on transcript changes, debounced, and at least every
  20 s).
- Per-card browser state (open, current URL, following) is kept in memory for
  the window's life and moves with the card when a launched session is adopted
  under its real id, like its terminal.
- Where `<webview>` is unavailable (not running in Electron), the pane shows
  the links with an open-in-system-browser action only.

### Terminal links

Clicking a web URL in a card's terminal opens it in that card's browser
(opening the pane if needed) instead of the system browser. This is an
`OpenHandler` for `http(s)` URIs that takes priority only while focus is
inside a pinned card's terminal; everywhere else the default handler still
opens the system browser.

## Acceptance criteria

### Slice 1 — `<webview>` enabled, safely

- **AC-1** The main window is created with `webviewTag: true` and every other
  Theia default `webPreferences` value unchanged (`contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: false` for the host, …).
- **AC-2** A guest attached with a `preload`, `nodeIntegration` or a non-web
  `src` is attached without the preload, with `nodeIntegration: false`,
  `contextIsolation: true`, `sandbox: true`, or not attached at all for a
  non-web `src`. The policy is a pure function with unit tests.
- **AC-3** In a guest, clicking an `https` link navigates; a `target=_blank`
  link opens in the same guest; a `file:` or custom-scheme navigation is
  blocked. Outside guests, Theia's navigation block is unchanged.

### Slice 2 — Session links

- **AC-4** `extractLinks` finds GitHub pull-request URLs and localhost URLs in
  tool results and assistant text, labels them, normalises `127.0.0.1` and
  `0.0.0.0` to `localhost`, strips trailing punctuation, deduplicates, and
  orders newest first. Unit-tested with transcript fixtures.
- **AC-5** `listSessionLinks` reads the transcript incrementally (first call
  from the last 2 MB), keeps per-session state while the backend runs, and
  returns `[]` for unknown sessions and sessions without a transcript file.

### Slice 3 — Card browser

- **AC-6** The Browser toggle opens and closes a pane under the card body; the
  divider resizes it within 20–80 %, and the ratio survives a reload.
- **AC-7** Opening the pane shows the newest session link, or the empty state.
  A new link replaces the page while following; after the user types an
  address it does not, until a session link is picked again.
- **AC-8** The address field, back/forward/reload and open-externally work; a
  bare host gets `https://`.
- **AC-9** The pane's state survives re-renders and layout changes, and moves
  with a launched card when it is adopted.
- **AC-10** The following logic (which URL to show after a links update) is a
  pure function with unit tests.

### Slice 4 — Terminal links into the card

- **AC-11** Clicking a web URL in a pinned card's terminal opens it in that
  card's browser, opening the pane if needed. A URL clicked anywhere else still
  opens the system browser.

## Non-goals

- A general-purpose browser: no tabs, bookmarks, history view or downloads UI.
- Links from opencode sessions, which have no transcript file.
- Detecting arbitrary URLs: only pull requests and local servers are followed.
  Any URL can still be typed or clicked in the terminal.
- Persisting the pane's state across window reloads.

## Risks

- **Security.** A guest runs remote content inside the app. Mitigated by the
  hardened attach policy (no preload, no Node, sandboxed, context-isolated,
  web schemes only) and a dedicated partition.
- **Memory.** Each open browser pane is a renderer process. Panes are opened
  on demand and destroyed with the card.
- **Electron regressions.** `<webview>` is a supported but de-emphasised
  Electron API. The main-process pieces are small and isolated behind the
  subclass, so a later move to `WebContentsView` does not touch the card.
- **Following surprises.** A page the user is reading is replaced by a new
  link only while they have not typed an address; picking from the list or
  in-page navigation keeps following, which may still surprise. Revisit with
  usage.
