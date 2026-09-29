# Photo backdrop — a halftone photo behind the Spec and Dark Factory panels

> **What is this file.** Design for a second backdrop behind SPEXR's Spec and Dark Factory
> panels: a photo drawn as halftone dots by `@sondalab/ui-kit`'s halftone core, chosen by a
> preference next to the existing Game of Life. Audience: engineers building or reviewing it.
> Owner: marcello.barile. Companion: the plan `docs/superpowers/plans/2026-09-29-photo-backdrop.md`
> is the task breakdown; the kit side is `sondalab-ui/docs/specs/2026-09-28-halftone-dots-design.md`
> (shipped in `@sondalab/ui-kit` 0.19.0).

## Status legend

- **Shipped** — merged and available to users.
- **Implemented (not delivered)** — committed on a branch, not merged.

Everything below is **Implemented (not delivered)**, on `feat/photo-backdrop`.

## What the user asked

- The backdrop is configurable: the Game of Life (today's) or a photo viewer.
- The photo viewer passes the photo through the kit's halftone mechanism.
- By default it shows random royalty-free photos with a sci-fi, futuristic look. First pass: a
  curated list shipped with SPEXR. Revised on 2026-09-29: "a plethora of different images" from
  the web (Unsplash was asked for; it needs an access key, so Openverse is the key-free default and
  Unsplash the upgrade), rotating every N seconds, N a preference.
- The halftone is a square, anchored to the bottom-right corner, big enough to cover at least
  half of the panel.

## Design

### Preferences

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `spexr.backdrop.kind` | `"life"` \| `"photo"` | `"life"` | Which backdrop the Spec and Dark Factory panels draw. |
| `spexr.backdrop.photoSource` | `"openverse"` \| `"unsplash"` \| `"curated"` | `"openverse"` | Where photos come from. `"unsplash"` without a key uses Openverse; `"curated"` never touches the network. |
| `spexr.backdrop.photoQueries` | `string[]` | nine terms (below) | Search terms; each batch comes from one, picked at random. |
| `spexr.backdrop.photoIntervalSeconds` | `number` | `60` | Seconds each photo stays; at least 10 (each new photo gathers at the display rate for ≈2 s). |
| `spexr.backdrop.unsplashAccessKey` | `string` | `""` | The access key of the user's own Unsplash app. Stored in plain text in settings. |
| `spexr.backdrop.photos` | `string[]` | `[]` | Picture URLs to cycle instead of any source. A URL on another origin must allow cross-origin resource sharing (CORS), or it is skipped. |

Default queries, chosen from sampled results (terms like "sci-fi", "robot" and "spaceship" returned
posters and toys): cyberpunk city, neon city, nebula, milky way, rocket launch, long exposure city,
skyscraper night, futuristic architecture, tunnel light. Openverse answers 240 results per query
without a key, so the defaults reach about 2,100 photos.

A change applies live, without reopening a panel.

### Components

- `backdrop/backdrop.tsx` — `<Backdrop preferences>`: `backdropChoice()` turns the preferences
  into the Game of Life or a photo source and interval; it follows their changes, and replaces the
  direct `<LifeBackground />` in `darkfactory-wall-widget.tsx` and `spec-widget.tsx`.
- `backdrop/photo-feed.ts` — `PhotoFeed`: fetches a batch (20 from Openverse, a random page of the
  12 it serves; 30 from Unsplash's random endpoint) for a random query, serves it shuffled, never a
  photo already served this session while new ones exist. A failed or empty fetch serves a curated
  photo, and the next call tries the network again.
- `backdrop/photo-scene.ts` — `PhotoScene`: the clock (gather, tick, pause and resume, reduced
  motion, high contrast), with the page's clock, scheduler and canvas passed in.
- `backdrop/photo-rotation.ts` — `PhotoRotation`: shows the photo decoded ahead, then decodes the
  next one, so each rotation is instant; skips up to 5 photos that fail in a row.
- `backdrop/photo-background.tsx` — `<PhotoBackground source intervalMs>`: wires the scene, the
  rotation and the feed to the page (canvas, observers, the interval) and renders the credit line; a
  picture that takes over 15 s to load is skipped.
- `backdrop/photo-set.ts` — the curated set: 18 NASA images under `backdrop/photos/`, credited in
  `backdrop/photos/CREDITS.md`.

### Geometry

The canvas lives in the same zero-height sticky strip as the Life canvas and is sized from the
same host (the widget's scrolling node): its visible `clientWidth` × `clientHeight`. The square's
side is half the host's longer side, and it sits at `left = width − side`, `top = height − side`.
On a panel shorter than half its width, the square overflows the top edge; the strip does not clip,
so the panel's own overflow does. The halftone grid is 128 cells per side.

### Drawing — why SPEXR drives the kit's core rather than mounting the kit's live `halftone()`

The kit's `halftone()` runs a frame loop at the display rate for as long as a scene is near the
viewport. Behind SPEXR's glass panes every frame re-composites the window through their lenses:
that is what https://github.com/sondalab-ai/spexr-ide/pull/67 removed. So
`PhotoBackground` uses the kit's exported core (`@sondalab/ui-kit/halftone-core.js`:
`sampleDots`, `dotFrame`, `settledFrame`, `cover`) on its own clock:

- the gather (≈1.8 s: longest delay 0.7 s + assemble 1.1 s) at the display rate, once per photo;
- then the drift, breath and scan at the Life backdrop's tick (120 ms), so the photo costs what
  the Game of Life costs.

The canvas carries no `data-sl-halftone`, so the kit's own runtime never arms it.

### Credit

Under the square, at the visible area's bottom-right: "Photo: <author> · <licence> · via
Openverse", "Photo by <author> on Unsplash" (with the referral links Unsplash requires), or
"Photo: NASA/… · via NASA", each part linked where the source gives a link. It sits in its own
sticky strip at `z-index: 2`, above the panel content (`z-index: 1`), so its links take clicks;
the rest of the strip lets clicks through.

### Photos

- One when the backdrop mounts (about 3 s from Openverse: its search takes 1.4–2.4 s, a
  thumbnail about 1 s), then one every `photoIntervalSeconds`; each new photo gathers again. No
  rotation while the clock is stopped, so a paused window does not fetch.
- Openverse photos come through its thumbnail proxy (`api.openverse.org/v1/images/<id>/thumb/`,
  600 px, `Access-Control-Allow-Origin: *`); Unsplash photos as a 640 px crop of `urls.raw`, and
  each one shown is reported to its `download_location`, as Unsplash's API guidelines ask.
- Each picture is decoded with `crossOrigin = "anonymous"`, cover-cropped to a square and sampled
  at twice the grid. A picture that fails to load or taints the canvas is skipped for the next one;
  if all fail, nothing is drawn.
- The curated files are 320 px greyscale JPEGs (147 KB for the set). The Theia build inlines
  `.jpg` imports as data URLs (`gen-esbuild.browser.mjs`: `'.jpg': 'dataurl'`), so the set ships
  inside the frontend bundle, with no network access.

### Colour

The dots take the canvas's `color` (the accent, like the Life canvas), at a faint opacity set in
CSS. They always print the picture's light, in either theme. This departs from the kit's live
`halftone()`, where ink darker than mid-grey prints the picture's dark: the curated photos are
light subjects on dark fields, and inverted, their dark sky prints as one solid blot with the
subject as a hole (seen in the headless check on the light theme). Photos from the web follow the
same rule.

### States

| State | Photo backdrop |
| --- | --- |
| Reduced motion | The settled frame, drawn once per photo; no gather, no drift. |
| Motion paused (`data-spexr-motion="paused"`) | The clock stops; the frame holds; it resumes from where it stopped. |
| Power saving (`data-spexr-power-save`) | Same as motion paused. |
| High contrast | Nothing is drawn (the Life backdrop's rule, and the kit's). |
| Panel or window hidden | The clock stops. |

The design approved in chat said the canvas unmounts while saving power. Holding the frame instead
matches what the Life backdrop does while saving and costs nothing, since no timer runs.

## Testing

- `photo-feed.test.ts`: request URLs, licence labels, parsing of both services (including error
  bodies), batching without repeats, the curated fallback, the Unsplash key header and download
  report, a fixed list without network.
- `photo-scene.test.ts`: every frame while gathering, then every 120 ms; the frame held while
  paused and resumed from it; a photo shown while paused held gathered; the settled picture once
  under reduced motion; a cleared square when nothing may be drawn; dispose stops everything.
- `photo-rotation.test.ts`: the next photo decoded ahead; failures skipped up to the limit; an
  empty feed; an advance while loading dropped; nothing shown after dispose.
- `backdrop-style.test.ts` (CSS, in the style of `power-save-style.test.ts`): the shared sticky
  strip takes no clicks; the backdrop under the content and the credit above it; only the credit's
  links take clicks; both hidden in high contrast; the photo faint, in the accent, in both themes.
- `photo-set.test.ts`: the curated set has 18 credited entries.
- `photo-geometry.test.ts`: the square's side and offset for wide, tall, square and empty hosts.
- `backdrop.test.ts`: the Game of Life by default; Openverse with the default queries and 60 s;
  Unsplash only with a key; the curated source; your URLs over any source; the 10 s floor.
- A headless page against the live Openverse API: a photo and its credit appear, the credit link
  takes clicks over the content, a 10 s interval swaps to the prefetched photo, and with the API
  blocked a NASA photo stands in.
- `pnpm build:dev` for the desktop bundle (the `.jpg` data-URL path), then the running app.

## Out of scope

- Local file paths in `spexr.backdrop.photos` (only URLs).
- A picker UI; the preference editor is enough.
- Storing the Unsplash key in a secret store; it sits in settings like other SPEXR keys.
- Unsplash's production approval (its demo mode allows 50 requests an hour, 1,500 photos at 30
  per request).
