import { describe, expect, it } from "vitest";
import { memoizeFor } from "./ttl-memo.js";

describe("memoizeFor", () => {
  function counting() {
    let calls = 0;
    return { fn: async () => ++calls, calls: () => calls };
  }

  it("reuses the answer within the window", async () => {
    let t = 0;
    const src = counting();
    const memo = memoizeFor(15_000, () => t, src.fn);
    expect(await memo()).toBe(1);
    t = 14_999;
    expect(await memo()).toBe(1);
    expect(src.calls()).toBe(1);
  });

  it("asks again once the window has passed", async () => {
    let t = 0;
    const src = counting();
    const memo = memoizeFor(15_000, () => t, src.fn);
    await memo();
    t = 15_000;
    expect(await memo()).toBe(2);
  });

  it("shares one call between concurrent callers", async () => {
    const src = counting();
    const memo = memoizeFor(15_000, () => 0, src.fn);
    await Promise.all([memo(), memo(), memo()]);
    expect(src.calls()).toBe(1);
  });

  it("does not keep a failure", async () => {
    let fail = true;
    const memo = memoizeFor(15_000, () => 0, async () => {
      if (fail) throw new Error("boom");
      return "ok";
    });
    await expect(memo()).rejects.toThrow("boom");
    fail = false;
    expect(await memo()).toBe("ok");
  });
});
