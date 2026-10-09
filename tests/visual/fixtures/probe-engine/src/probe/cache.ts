import { Evidence } from "./evidence";
import type { Answer } from "./types";

export { Evidence };

/** A cached answer, and whether it has outlived the probe's ttl. */
export interface Hit {
  readonly answer: Answer;
  readonly writtenAt: number;
  stale(ttl: number): boolean;
}

/** Where answers live, keyed by probe. Writes are awaited by the caller. */
export class Cache {
  private readonly entries = new Map<string, { answer: Answer; writtenAt: number }>();

  async read(key: string): Promise<Hit | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    return {
      ...entry,
      stale: (ttl) => Date.now() - entry.writtenAt > ttl,
    };
  }

  async write(key: string, answer: Answer): Promise<void> {
    this.entries.set(key, { answer, writtenAt: Date.now() });
  }

  get size(): number {
    return this.entries.size;
  }
}
