import { describe, expect, it } from "vitest";
import { BM25Index } from "./bm25-index.js";

/**
 * Four documents so the rarity of a term is decided by `df`, not by a coin
 * flip. "panel" and "session" are in every document and "hardening" in one, a
 * gap wide enough that the idf ordering does not depend on the tuning of `K1`
 * or `B` — on a two-document corpus it would.
 */
function index(): BM25Index {
  const idx = new BM25Index();
  idx.upsert("a", "panel panel panel session hardening");
  idx.upsert("b", "panel session session session embedding");
  idx.upsert("c", "panel session");
  idx.upsert("d", "panel session");
  return idx;
}

describe("BM25Index.explain", () => {
  it("says nothing when no query term is in the corpus at all", () => {
    expect(index().explain("a", "kubernetes helm chart")).toEqual([]);
  });

  it("leaves out a query term the document does not have", () => {
    expect(index().explain("a", "hardening embedding")).toEqual(["hardening"]);
  });

  it("puts the rare term first, over a common one the document repeats", () => {
    // "panel" occurs three times in the document and "hardening" once, but
    // "hardening" is in one document of four against "panel" in all of them.
    // Rarity is most of the score, and the order has to reflect that.
    expect(index().explain("a", "panel hardening")).toEqual(["hardening", "panel"]);
  });

  it("caps the list at the limit", () => {
    expect(index().explain("a", "panel session hardening", 2)).toHaveLength(2);
  });

  it("reports a term once however many times the query repeats it", () => {
    expect(index().explain("a", "panel panel panel")).toEqual(["panel"]);
  });

  it("has nothing to say about a document it does not hold", () => {
    expect(index().explain("missing", "panel")).toEqual([]);
  });

  it("agrees with score: a document scoring zero explains nothing", () => {
    const idx = index();
    expect(idx.score("embedding", ["a"]).get("a")).toBe(0);
    expect(idx.explain("a", "embedding")).toEqual([]);
  });
});
