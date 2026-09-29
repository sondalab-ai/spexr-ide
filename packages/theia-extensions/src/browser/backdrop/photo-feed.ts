/** Who made a photo and where it came from, as the photo backdrop's credit line shows it. */
export interface PhotoCredit {
  readonly author: string;
  readonly authorUrl?: string | undefined;
  /** The service the photo was found through: "Openverse", "Unsplash", "NASA". */
  readonly via: string;
  readonly viaUrl?: string | undefined;
  /** The photo's own page. */
  readonly pageUrl?: string | undefined;
  readonly license?: string | undefined;
}

export interface Photo {
  readonly url: string;
  readonly credit?: PhotoCredit | undefined;
  /** A URL to request once the photo is on screen (Unsplash's download event). */
  readonly shown?: string | undefined;
}

export type PhotoSource =
  | { readonly kind: "openverse"; readonly queries: readonly string[] }
  | { readonly kind: "unsplash"; readonly queries: readonly string[]; readonly key: string }
  | { readonly kind: "list"; readonly photos: readonly Photo[] };

const OPENVERSE = "https://api.openverse.org/v1/images/";
/** Openverse answers at most 240 results per query without a key: 12 pages of 20. */
const OPENVERSE_PAGE_SIZE = 20;
const OPENVERSE_PAGES = 12;
const UNSPLASH = "https://api.unsplash.com/photos/random";
const UNSPLASH_COUNT = 30;
const REFERRAL = "utm_source=spexr&utm_medium=referral";
/** Photos remembered as shown before the memory resets, so a long session can revisit. */
const SEEN_LIMIT = 5000;

/** An Openverse search for commercial-use, non-mature photographs, one page of results. */
export function openverseUrl(query: string, page: number): string {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    page_size: String(OPENVERSE_PAGE_SIZE),
    license_type: "commercial",
    category: "photograph",
    mature: "false",
  });
  return `${OPENVERSE}?${params}`;
}

/** An Unsplash request for random photos matching `query`. */
export function unsplashUrl(query: string): string {
  const params = new URLSearchParams({
    query,
    count: String(UNSPLASH_COUNT),
    content_filter: "high",
  });
  return `${UNSPLASH}?${params}`;
}

/** A Creative Commons licence as its deed names it: "CC BY-SA 2.0", "CC0", "Public domain". */
export function licenseLabel(license: string, version: string | undefined): string {
  if (license === "cc0") return "CC0";
  if (license === "pdm") return "Public domain";
  return ["CC", license.toUpperCase(), version].filter(Boolean).join(" ");
}

const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : undefined;

/** Openverse results as photos, drawn from its CORS-enabled thumbnail proxy. */
export function parseOpenverse(body: unknown): Photo[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const photos: Photo[] = [];
  for (const r of results as Record<string, unknown>[]) {
    const url = text(r.thumbnail);
    if (!url) continue;
    const license = text(r.license);
    photos.push({
      url,
      credit: {
        author: text(r.creator) ?? "Unknown",
        authorUrl: text(r.creator_url),
        via: "Openverse",
        pageUrl: text(r.foreign_landing_url),
        license: license && licenseLabel(license, text(r.license_version)),
      },
    });
  }
  return photos;
}

interface UnsplashResult {
  readonly urls?: { readonly raw?: unknown };
  readonly user?: { readonly name?: unknown; readonly links?: { readonly html?: unknown } };
  readonly links?: { readonly download_location?: unknown };
}

/** Unsplash results as photos: a 640 px square crop, credited with the referral links Unsplash requires. */
export function parseUnsplash(body: unknown): Photo[] {
  if (!Array.isArray(body)) return [];
  const photos: Photo[] = [];
  for (const r of body as (UnsplashResult | null)[]) {
    const raw = text(r?.urls?.raw);
    if (!raw) continue;
    const url = new URL(raw);
    for (const [k, v] of Object.entries({ w: "640", h: "640", fit: "crop", fm: "jpg", q: "70" }))
      url.searchParams.set(k, v);
    const profile = text(r?.user?.links?.html);
    photos.push({
      url: url.toString(),
      credit: {
        author: text(r?.user?.name) ?? "Unknown",
        authorUrl: profile && `${profile}?${REFERRAL}`,
        via: "Unsplash",
        viaUrl: `https://unsplash.com/?${REFERRAL}`,
      },
      shown: text(r?.links?.download_location),
    });
  }
  return photos;
}

export interface PhotoFeedOptions {
  readonly source: PhotoSource;
  /** Served when the network fails or answers nothing new. */
  readonly fallback: readonly Photo[];
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  readonly random?: () => number;
}

/**
 * An endless supply of photos for the photo backdrop. It fetches a batch at
 * a time (20 from Openverse, 30 from Unsplash) for a random query, serves
 * them in random order, and never serves a photo it has already served this
 * session while there are new ones. A failed or empty fetch serves one from
 * `fallback` instead, and the next call tries the network again.
 */
export class PhotoFeed {
  private queue: Photo[] = [];
  private readonly seen = new Set<string>();
  private previous: string | undefined;
  private readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly random: () => number;

  constructor(private readonly options: PhotoFeedOptions) {
    this.fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.random = options.random ?? Math.random;
  }

  async next(): Promise<Photo> {
    if (this.queue.length === 0) this.queue = await this.batch();
    const photo = this.queue.shift() ?? this.pick(this.options.fallback);
    this.previous = photo.url;
    this.seen.add(photo.url);
    if (this.seen.size > SEEN_LIMIT) this.seen.clear();
    return photo;
  }

  /** Tell the source a photo is on screen: Unsplash counts it as a download, as its guidelines ask. */
  shown(photo: Photo): void {
    const { source } = this.options;
    if (source.kind !== "unsplash" || !photo.shown) return;
    void this.fetch(photo.shown, { headers: { Authorization: `Client-ID ${source.key}` } }).catch(
      () => undefined,
    );
  }

  private async batch(): Promise<Photo[]> {
    const { source } = this.options;
    if (source.kind === "list") {
      return this.shuffle(
        source.photos.length > 1
          ? source.photos.filter((p) => p.url !== this.previous)
          : source.photos,
      );
    }
    const query = source.queries[Math.floor(this.random() * source.queries.length)];
    if (query === undefined) return [];
    try {
      const res =
        source.kind === "openverse"
          ? await this.fetch(openverseUrl(query, 1 + Math.floor(this.random() * OPENVERSE_PAGES)))
          : await this.fetch(unsplashUrl(query), {
              headers: { Authorization: `Client-ID ${source.key}`, "Accept-Version": "v1" },
            });
      if (!res.ok) return [];
      const body: unknown = await res.json();
      const photos = source.kind === "openverse" ? parseOpenverse(body) : parseUnsplash(body);
      return this.shuffle(photos.filter((p) => !this.seen.has(p.url)));
    } catch {
      return [];
    }
  }

  /** A random entry, not the one just shown when there is another. */
  private pick(photos: readonly Photo[]): Photo {
    const others = photos.length > 1 ? photos.filter((p) => p.url !== this.previous) : photos;
    return (
      others[Math.min(others.length - 1, Math.floor(this.random() * others.length))] ?? { url: "" }
    );
  }

  private shuffle(photos: readonly Photo[]): Photo[] {
    const out = [...photos];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(this.random() * (i + 1)));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}
