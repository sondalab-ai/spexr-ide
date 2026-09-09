import { describe, expect, it } from "vitest";
import { BM25Index } from "./bm25-index.js";

/** Two documents sharing a common word, each with one word of its own. */
function index(): BM25Index {
  const idx = new BM25Index();
  idx.upsert("a", "panel panel panel session hardening");
  idx.upsert("b", "panel session session session embedding");
  return idx;
}

describe("BM25Index.explain", () => {
  it("names only the query terms the document contains", () => {
    expect(index().explain("hardening embedding", 10)).toEqual([]);
  });

  it("leaves out a query term the document does not have", () => {
    expect(index().explain("a", "hardening embedding")).toEqual(["hardening"]);
  });

  it("puts the rarer term first, since it is most of the score", () => {
    // "hardening" is in one document of two, "panel" in both — so the rare one
    // carries the higher idf and should lead even though "panel" occurs more.
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
