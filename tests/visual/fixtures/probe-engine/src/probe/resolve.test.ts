import { describe, expect, it } from "vitest";
import { Cache } from "./cache";
import { resolve } from "./resolve";
import type { Probe } from "./types";

const probe = (run: Probe["run"]): Probe => ({ id: "q-8f2a", key: "colour-contract", ttl: 60_000, run });

describe("resolve", () => {
  it("returns the cached answer", async () => {
    const cache = new Cache();
    await cache.write("colour-contract", { ok: true });
    const answer = await resolve(probe(async () => ({ ok: false })), cache);
    expect(answer).toEqual({ ok: true });
  });

  it("re-runs a stale probe and keeps evidence", async () => {
    const cache = new Cache();
    const answer = await resolve(probe(async ({ evidence }) => (evidence.mark("ran", 1), { ok: true })), cache);
    expect(answer).toEqual({ ok: true });
    expect(cache.size).toBe(1);
  });
});
