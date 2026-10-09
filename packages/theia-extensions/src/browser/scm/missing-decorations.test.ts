import { describe, expect, it } from "vitest";
import { MissingDecorations } from "./missing-decorations.js";

/** A decorations service as the adapter asks it, counting the questions. */
function fakeService(decorated: string[]) {
  const asked: string[] = [];
  return {
    asked,
    decorated: new Set(decorated),
    has(key: string): boolean {
      asked.push(key);
      return this.decorated.has(key);
    },
  };
}

describe("the decorations a file-tree adapter has not been told of", () => {
  it("finds the decorated nodes of an Explorer created after git's status arrived", () => {
    const service = fakeService(["file:///w/a.ts", "file:///w/b.ts"]);
    const known = new Set<string>();
    const missing = new MissingDecorations();
    const tree = ["file:///w", "file:///w/a.ts", "file:///w/b.ts", "file:///w/c.ts"];
    const found = missing.find(tree, (k) => known.has(k), (k) => service.has(k));
    expect(found).toEqual(["file:///w/a.ts", "file:///w/b.ts"]);
    for (const key of found) known.add(key);
    expect(missing.find(tree, (k) => known.has(k), (k) => service.has(k))).toEqual([]);
  });

  it("asks the service about a plain node once, not on every redraw", () => {
    const service = fakeService([]);
    const missing = new MissingDecorations();
    const tree = ["x", "y", "z"];
    for (let i = 0; i < 5; i++) missing.find(tree, () => false, (k) => service.has(k));
    expect(service.asked).toEqual(["x", "y", "z"]);
  });

  it("never asks about a node the adapter already knows", () => {
    const service = fakeService(["x"]);
    new MissingDecorations().find(["x"], () => true, (k) => service.has(k));
    expect(service.asked).toEqual([]);
  });

  it("asks again after the service reports a change, when a plain node may have gained a decoration", () => {
    const service = fakeService([]);
    const missing = new MissingDecorations();
    expect(missing.find(["x"], () => false, (k) => service.has(k))).toEqual([]);
    service.decorated.add("x");
    expect(missing.find(["x"], () => false, (k) => service.has(k))).toEqual([]);
    missing.forget();
    expect(missing.find(["x"], () => false, (k) => service.has(k))).toEqual(["x"]);
  });
});
