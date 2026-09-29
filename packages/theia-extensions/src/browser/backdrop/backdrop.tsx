import * as React from "@theia/core/shared/react";
import type { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { LifeBackground } from "./life-background.js";
import { PhotoBackground } from "./photo-background.js";
import { CURATED } from "./photo-set.js";
import type { PhotoSource } from "./photo-feed.js";
import {
  DEFAULT_BACKDROP_PHOTO_QUERIES,
  MIN_BACKDROP_PHOTO_INTERVAL_SECONDS,
  SPEXR_BACKDROP_KIND_PREFERENCE,
  SPEXR_BACKDROP_PHOTOS_PREFERENCE,
  SPEXR_BACKDROP_PHOTO_INTERVAL_PREFERENCE,
  SPEXR_BACKDROP_PHOTO_QUERIES_PREFERENCE,
  SPEXR_BACKDROP_PHOTO_SOURCE_PREFERENCE,
  SPEXR_BACKDROP_UNSPLASH_KEY_PREFERENCE,
} from "../preferences/spexr-preferences.js";

const PREFERENCES = [
  SPEXR_BACKDROP_KIND_PREFERENCE,
  SPEXR_BACKDROP_PHOTOS_PREFERENCE,
  SPEXR_BACKDROP_PHOTO_SOURCE_PREFERENCE,
  SPEXR_BACKDROP_PHOTO_QUERIES_PREFERENCE,
  SPEXR_BACKDROP_PHOTO_INTERVAL_PREFERENCE,
  SPEXR_BACKDROP_UNSPLASH_KEY_PREFERENCE,
] as const;

export type BackdropChoice =
  | { readonly kind: "life" }
  | { readonly kind: "photo"; readonly source: PhotoSource; readonly intervalMs: number };

const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim())
    : [];

/**
 * What the `spexr.backdrop.*` preferences ask for. Anything but "photo" is the
 * Game of Life. For the photo: your own URLs win; then the source, with
 * Unsplash falling back to Openverse without a key; the interval is clamped
 * to its minimum.
 */
export function backdropChoice(
  read: (key: (typeof PREFERENCES)[number]) => unknown,
): BackdropChoice {
  if (read(SPEXR_BACKDROP_KIND_PREFERENCE) !== "photo") return { kind: "life" };
  const seconds = Number(read(SPEXR_BACKDROP_PHOTO_INTERVAL_PREFERENCE));
  const intervalMs =
    1000 *
    Math.max(
      MIN_BACKDROP_PHOTO_INTERVAL_SECONDS,
      Number.isFinite(seconds) && seconds > 0 ? seconds : 60,
    );
  const urls = strings(read(SPEXR_BACKDROP_PHOTOS_PREFERENCE));
  const queries = strings(read(SPEXR_BACKDROP_PHOTO_QUERIES_PREFERENCE));
  const key = strings([read(SPEXR_BACKDROP_UNSPLASH_KEY_PREFERENCE)])[0];
  const wanted = read(SPEXR_BACKDROP_PHOTO_SOURCE_PREFERENCE);
  const source: PhotoSource =
    urls.length > 0
      ? { kind: "list", photos: urls.map((url) => ({ url })) }
      : wanted === "curated"
        ? { kind: "list", photos: CURATED }
        : wanted === "unsplash" && key
          ? {
              kind: "unsplash",
              queries: queries.length > 0 ? queries : DEFAULT_BACKDROP_PHOTO_QUERIES,
              key,
            }
          : {
              kind: "openverse",
              queries: queries.length > 0 ? queries : DEFAULT_BACKDROP_PHOTO_QUERIES,
            };
  return { kind: "photo", source, intervalMs };
}

/**
 * The backdrop `spexr.backdrop.kind` picks for a panel: the Game of Life or
 * the halftone photo. Mount it where the Life backdrop went, as the first
 * child of the widget's scrolling node. It follows the preferences live.
 */
export function Backdrop({
  preferences,
}: {
  readonly preferences: PreferenceService;
}): React.ReactElement {
  const read = React.useCallback(
    () => backdropChoice((key) => preferences.get<unknown>(key)),
    [preferences],
  );
  const [choice, setChoice] = React.useState(read);

  React.useEffect(() => {
    setChoice(read());
    const listener = preferences.onPreferenceChanged((e) => {
      if ((PREFERENCES as readonly string[]).includes(e.preferenceName)) setChoice(read());
    });
    return () => listener.dispose();
  }, [preferences, read]);

  return choice.kind === "photo" ? (
    <PhotoBackground source={choice.source} intervalMs={choice.intervalMs} />
  ) : (
    <LifeBackground />
  );
}
