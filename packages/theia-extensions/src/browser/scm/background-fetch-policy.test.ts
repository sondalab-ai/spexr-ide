import { describe, expect, it } from "vitest";
import { BACKGROUND_FETCH_INTERVAL_MS, shouldFetchNow } from "./background-fetch-policy.js";

describe("shouldFetchNow", () => {
  it("fetches when nothing has been fetched yet", () => {
    expect(shouldFetchNow(undefined, 1_000)).toBe(true);
  });

  it("holds off until the interval has elapsed, so alt-tabbing does not fetch each time", () => {
    const last = 10_000;
    expect(shouldFetchNow(last, last + BACKGROUND_FETCH_INTERVAL_MS - 1)).toBe(false);
    expect(shouldFetchNow(last, last + BACKGROUND_FETCH_INTERVAL_MS)).toBe(true);
  });

  it("takes the interval as an argument so a caller can be stricter", () => {
    expect(shouldFetchNow(0, 500, 1_000)).toBe(false);
    expect(shouldFetchNow(0, 1_500, 1_000)).toBe(true);
  });
});
