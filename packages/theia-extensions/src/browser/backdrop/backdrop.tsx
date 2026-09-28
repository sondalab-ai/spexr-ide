import * as React from "@theia/core/shared/react";
import type { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { LifeBackground } from "./life-background.js";
import { PhotoBackground } from "./photo-background.js";
import { CURATED_PHOTOS } from "./photo-set.js";
import {
  SPEXR_BACKDROP_KIND_PREFERENCE,
  SPEXR_BACKDROP_PHOTOS_PREFERENCE,
} from "../preferences/spexr-preferences.js";

export type BackdropKind = "life" | "photo";

/** What `spexr.backdrop.*` asks for: anything but "photo" is the Game of Life; no URLs is the curated set. */
export function backdropChoice(kind: unknown, photos: unknown): { kind: BackdropKind; photos: readonly string[] } {
  const urls = Array.isArray(photos)
    ? photos.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim())
    : [];
  return { kind: kind === "photo" ? "photo" : "life", photos: urls.length > 0 ? urls : CURATED_PHOTOS };
}

/**
 * The backdrop `spexr.backdrop.kind` picks for a panel: the Game of Life or
 * the halftone photo. Mount it where the Life backdrop went, as the first
 * child of the widget's scrolling node. It follows the preferences live.
 */
export function Backdrop({ preferences }: { readonly preferences: PreferenceService }): React.ReactElement {
  const read = React.useCallback(
    () =>
      backdropChoice(
        preferences.get<unknown>(SPEXR_BACKDROP_KIND_PREFERENCE),
        preferences.get<unknown>(SPEXR_BACKDROP_PHOTOS_PREFERENCE),
      ),
    [preferences],
  );
  const [choice, setChoice] = React.useState(read);

  React.useEffect(() => {
    setChoice(read());
    const listener = preferences.onPreferenceChanged((e) => {
      if (e.preferenceName === SPEXR_BACKDROP_KIND_PREFERENCE || e.preferenceName === SPEXR_BACKDROP_PHOTOS_PREFERENCE) {
        setChoice(read());
      }
    });
    return () => listener.dispose();
  }, [preferences, read]);

  return choice.kind === "photo" ? <PhotoBackground photos={choice.photos} /> : <LifeBackground />;
}
