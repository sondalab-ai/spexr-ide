import type { SessionHit } from "../../common/darkfactory-protocol.js";

/** Typing settles for this long before a query is issued. */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * Query state for the wall's search bar, kept out of the widget so the timing
 * rules — debounce, supersede, clear — are testable without a DOM.
 */
export class SessionSearchState {
  query = "";
  hits: SessionHit[] = [];
  pending = false;

  private seq = 0;
  private timer?: ReturnType<typeof setTimeout>;

  /** `onChange` fires when accepted results change what should be on screen. */
  constructor(private readonly onChange: () => void = () => {}) {}

  /** True while a query is in force, so the wall should render hits, not tiles. */
  get active(): boolean {
    return this.query.trim().length > 0;
  }

  /** The token a result must still match to be accepted. */
  token(): number {
    return this.seq;
  }

  setQuery(text: string, run: (query: string) => Promise<SessionHit[]>): void {
    this.query = text;
    this.seq += 1;
    if (this.timer) clearTimeout(this.timer);
    if (!this.active) {
      this.hits = [];
      this.pending = false;
      return;
    }
    const token = this.seq;
    this.pending = true;
    this.timer = setTimeout(() => {
      void run(this.query.trim())
        .then((hits) => this.accept(token, hits))
        .catch(() => this.accept(token, []));
    }, SEARCH_DEBOUNCE_MS);
  }

  /** Take results only when they answer the query still on screen. */
  accept(token: number, hits: SessionHit[]): void {
    if (token !== this.seq) return;
    this.hits = hits;
    this.pending = false;
    this.onChange();
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.seq += 1;
    this.query = "";
    this.hits = [];
    this.pending = false;
  }
}
