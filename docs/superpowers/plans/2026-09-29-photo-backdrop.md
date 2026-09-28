# Photo backdrop Implementation Plan

> **For agentic workers:** executed natively in one session (the user was away and asked to
> proceed until blocked). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a preference-selected second backdrop, a halftone photo in the bottom-right corner,
next to the Game of Life.

**Architecture:** `<Backdrop>` chooses between `<LifeBackground>` and `<PhotoBackground>`;
`PhotoBackground` samples a picture with the kit's `halftone-core` and draws it on a throttled
clock.

**Tech Stack:** React (Theia's shared), `@sondalab/ui-kit` 0.19.0 `halftone-core.js`, vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-photo-backdrop-design.md`

## Global Constraints

- `@sondalab/ui-kit` `^0.19.0`.
- Grid 128; gather at the display rate, then a 120 ms tick; a new photo every 10 minutes.
- Square side = half the host's longer side, anchored bottom-right.
- Default `spexr.backdrop.kind` is `"life"`: an untouched install looks as before.
- Never run the full `pnpm test`; run focused vitest files (docs/memory).

## Review Focus

- A host narrower or shorter than the square: the canvas must not grow the scroll area.
- A photo URL that 404s or taints the canvas: skip it, never throw into React.
- Switching the preference back and forth: timers and observers are released each time.
- Motion pause released after a long pause: the drift resumes where it stopped, no jump.
- A light theme: dark ink prints the picture's dark, and still reads.

---

### Task 1: Kit bump, spec, plan, curated photos

- [ ] `@sondalab/ui-kit` → `^0.19.0` in `packages/ui-kit/package.json`, `pnpm install`.
- [ ] Add the 18 photos and `CREDITS.md` under `packages/theia-extensions/src/browser/backdrop/photos/`.
- [ ] Commit.

### Task 2: Re-export the halftone core, picker and geometry (TDD)

**Files:** `packages/ui-kit/src/halftone.ts` (+ `package.json` exports),
`packages/theia-extensions/src/browser/backdrop/photo-set.ts` (+ test),
`packages/theia-extensions/src/browser/backdrop/photo-geometry.ts` (+ test),
a `*.jpg` module declaration.

- [ ] Tests: `nextPhoto` never repeats with ≥2, returns the only one, `undefined` for none;
      `CURATED_PHOTOS.length === 18`; `squareFor(w, h)` for wide, tall, square and zero hosts.
- [ ] Implement; `copy-assets` also copies `backdrop/photos/*.jpg` into `lib/`.
- [ ] Commit.

### Task 3: Preferences, `<Backdrop>`, `<PhotoBackground>`, CSS

- [ ] `spexr.backdrop.kind`, `spexr.backdrop.photos` in `spexr-preferences.ts`.
- [ ] `backdrop.tsx` follows the preferences and switches; both widgets render it.
- [ ] `photo-background.tsx` per the spec's Drawing and States sections; CSS next to `.spexr-life-bg`.
- [ ] Lint, typecheck, focused tests, `pnpm build:dev`. Commit.

### Task 4: Verify in the running app

- [ ] Launch the built app with its own `--user-data-dir`; switch the preference; screenshot both
      panels in dark and light; check no per-frame repaint after the gather.
