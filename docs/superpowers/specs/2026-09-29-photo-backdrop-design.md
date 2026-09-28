# Photo backdrop — a halftone photo behind the Spec and Dark Factory panels

> **What is this file.** Design for a second backdrop behind SPEXR's Spec and Dark Factory
> panels: a photo drawn as halftone dots by `@sondalab/ui-kit`'s halftone core, chosen by a
> preference next to the existing Game of Life. Audience: engineers building or reviewing it.
> Owner: marcello.barile. Companion: the plan `docs/superpowers/plans/2026-09-29-photo-backdrop.md`
> is the task breakdown; the kit side is `sondalab-ui/docs/specs/2026-09-28-halftone-dots-design.md`
> (shipped in `@sondalab/ui-kit` 0.19.0).

## Status legend

- **Shipped** — merged and available to users.
- **Planned** — described here, not yet implemented.

Everything below is **Planned**.

## What the user asked

- The backdrop is configurable: the Game of Life (today's) or a photo viewer.
- The photo viewer passes the photo through the kit's halftone mechanism.
- By default it shows random royalty-free photos with a sci-fi, futuristic look, from a curated
  list shipped with SPEXR.
- The halftone is a square, anchored to the bottom-right corner, big enough to cover at least
  half of the panel.

## Design

### Preferences

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `spexr.backdrop.kind` | `"life"` \| `"photo"` | `"life"` | Which backdrop the Spec and Dark Factory panels draw. |
| `spexr.backdrop.photos` | `string[]` | `[]` | Picture URLs to cycle instead of the curated set. Empty uses the curated set. A URL on another origin must allow cross-origin resource sharing (CORS), or it is skipped. |

A change applies live, without reopening a panel.

### Components

- `backdrop/backdrop.tsx` — `<Backdrop preferences>`: reads both preferences, follows their
  changes, and renders `<LifeBackground>` or `<PhotoBackground photos>`. It replaces the direct
  `<LifeBackground />` in `darkfactory-wall-widget.tsx` and `spec-widget.tsx`.
- `backdrop/photo-background.tsx` — `<PhotoBackground>`: the halftone canvas.
- `backdrop/photo-set.ts` — the curated set (18 NASA images under `backdrop/photos/`,
  credited in `backdrop/photos/CREDITS.md`) and `nextPhoto(list, previous, random)`, the pure
  picker: a random entry, never the one just shown when there are two or more.

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

### Photos

- The picker chooses one when the backdrop mounts, and a new one every 10 minutes; each new photo
  gathers again.
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
subject as a hole (seen in the headless check on the light theme).

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

- `photo-set.test.ts`: the picker never repeats with two or more photos, returns the only one with
  one, handles an empty list; the curated set has 18 entries.
- `photo-geometry.test.ts`: the square's side and offset for wide, tall, square and empty hosts.
- `backdrop.test.ts`: the preference values map to the Game of Life by default, and to the curated
  set when no URL is given.
- `pnpm build:dev` for the desktop bundle (the `.jpg` data-URL path), then the running app.

## Out of scope

- Local file paths in `spexr.backdrop.photos` (only URLs).
- A picker UI; the preference editor is enough.
- Photo credits shown in the UI. They are in `backdrop/photos/CREDITS.md`, per
  [NASA's media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/).
