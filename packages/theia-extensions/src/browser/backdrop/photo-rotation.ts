import type { Photo } from "./photo-feed.js";

/** Photos tried in a row before a rotation gives up until the next one. */
export const TRIES = 5;

/** A photo with its decoded pixels, ready to show. */
export interface Ready<P> {
  readonly photo: Photo;
  readonly pixels: P;
}

export interface PhotoRotationOptions<P> {
  /** The next photo to try (PhotoFeed.next). An empty URL means there is none. */
  readonly next: () => Promise<Photo>;
  /** Decode a photo; throws when it cannot be read or takes too long. */
  readonly load: (url: string) => Promise<P>;
  readonly show: (ready: Ready<P>) => void;
  readonly tries?: number;
}

/**
 * Which photo the backdrop shows next. Each `advance()` shows the photo
 * decoded ahead (or decodes one now), then decodes the one after it, so a
 * rotation swaps at once rather than after a download. A photo that fails is
 * skipped for the next, up to `tries` in a row. An `advance()` while one is
 * still loading is dropped, and nothing is shown after `dispose()`.
 */
export class PhotoRotation<P> {
  private loading = false;
  private disposed = false;
  private upcoming: Promise<Ready<P> | undefined> | undefined;

  constructor(private readonly options: PhotoRotationOptions<P>) {}

  async advance(): Promise<void> {
    if (this.loading || this.disposed) return;
    this.loading = true;
    try {
      const ready = await (this.upcoming ?? this.fetch());
      this.upcoming = undefined;
      if (this.disposed) return;
      if (ready) this.options.show(ready);
      this.upcoming = this.fetch();
    } finally {
      this.loading = false;
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  private async fetch(): Promise<Ready<P> | undefined> {
    const tries = this.options.tries ?? TRIES;
    for (let i = 0; i < tries && !this.disposed; i++) {
      const photo = await this.options.next();
      if (!photo.url) return undefined;
      try {
        return { photo, pixels: await this.options.load(photo.url) };
      } catch {
        // Unreadable or too slow: the next one.
      }
    }
    return undefined;
  }
}
