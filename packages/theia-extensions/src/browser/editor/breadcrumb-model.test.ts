import { describe, expect, it } from "vitest";
import { breadcrumbMeta, crumbText, foldDiffStats, isCallableSymbol, isOutlineEllipsis, MINUS } from "./breadcrumb-model.js";

const span = (start: number, end: number) => ({ start, end });

describe("the breadcrumbs' symbol names (E6)", () => {
  it("gives functions and methods a pair of parentheses, as Lumen's resolve()", () => {
    expect(crumbText("resolve", "symbol-icon-center codicon codicon-symbol-function")).toBe("resolve()");
    expect(crumbText("read", "symbol-icon-center codicon codicon-symbol-method")).toBe("read()");
  });

  it("leaves every other symbol, and a file or folder, as it is", () => {
    expect(crumbText("Cache", "codicon codicon-symbol-class")).toBe("Cache");
    expect(crumbText("limit", "codicon codicon-symbol-variable")).toBe("limit");
    expect(crumbText("constructor", "codicon codicon-symbol-constructor")).toBe("constructor");
    expect(crumbText("resolve.ts", "file-icon")).toBe("resolve.ts");
    expect(crumbText("src")).toBe("src");
  });

  it("does not double the parentheses of a name that has them, nor match a kind by prefix", () => {
    expect(crumbText("run(a, b)", "codicon codicon-symbol-method")).toBe("run(a, b)");
    expect(isCallableSymbol("codicon codicon-symbol-function-like")).toBe(false);
    expect(isCallableSymbol(undefined)).toBe(false);
  });

  it("knows the trailing ellipsis", () => {
    expect(isOutlineEllipsis("…")).toBe(true);
    expect(isOutlineEllipsis("...")).toBe(false);
  });
});

describe("the DirtyDiff fold (E7)", () => {
  it("counts added lines from the current side and removed from the previous", () => {
    const changes = [
      { previousRange: span(10, 10), currentRange: span(10, 14) },
      { previousRange: span(20, 23), currentRange: span(24, 24) },
    ];
    expect(foldDiffStats(changes)).toEqual({ added: 4, removed: 3 });
  });

  it("counts a modification once on each side, and nothing for no changes", () => {
    expect(foldDiffStats([{ previousRange: span(5, 7), currentRange: span(5, 8) }])).toEqual({ added: 3, removed: 2 });
    expect(foldDiffStats([])).toEqual({ added: 0, removed: 0 });
  });

  it("sums the demo's +14 −3", () => {
    const changes = [
      { previousRange: span(0, 0), currentRange: span(0, 9) },
      { previousRange: span(30, 33), currentRange: span(39, 44) },
    ];
    expect(foldDiffStats(changes)).toEqual({ added: 14, removed: 3 });
  });
});

describe("the breadcrumb meta (E7)", () => {
  it("reads +a −d · not saved when the file differs and is dirty", () => {
    expect(breadcrumbMeta({ added: 14, removed: 3 }, true)).toBe(`+14 ${MINUS}3 · not saved`);
  });

  it("drops 'not saved' once the editor is clean", () => {
    expect(breadcrumbMeta({ added: 14, removed: 3 }, false)).toBe(`+14 ${MINUS}3`);
  });

  it("shows 'not saved' alone with no stat, and nothing when clean and unchanged", () => {
    expect(breadcrumbMeta(undefined, true)).toBe("not saved");
    expect(breadcrumbMeta({ added: 0, removed: 0 }, true)).toBe("not saved");
    expect(breadcrumbMeta({ added: 0, removed: 0 }, false)).toBe("");
    expect(breadcrumbMeta(undefined, false)).toBe("");
  });

  it("uses the true minus sign, not a hyphen", () => {
    expect(breadcrumbMeta({ added: 0, removed: 2 }, false)).toBe("+0 −2");
    expect(MINUS).toBe("−");
  });
});
