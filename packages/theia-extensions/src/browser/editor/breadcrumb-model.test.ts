import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { breadcrumbMeta, visibleCrumbs, crumbText, isCallableSymbol, isOutlineEllipsis, MINUS } from "./breadcrumb-model.js";

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

describe("the trailing ellipsis (E6)", () => {
  const OUTLINE = Symbol("outline");
  const FILE = Symbol("file");
  const crumb = (label: string, type: symbol) => ({ label, type });

  it("is dropped after a symbol crumb", () => {
    const row = [crumb("src", FILE), crumb("resolve.ts", FILE), crumb("resolve", OUTLINE), crumb("…", OUTLINE)];
    expect(visibleCrumbs(row).map((c) => c.label)).toEqual(["src", "resolve.ts", "resolve"]);
  });

  it("stays when it is the only outline crumb, so the symbol picker is reachable from outside every symbol", () => {
    const row = [crumb("src", FILE), crumb("resolve.ts", FILE), crumb("…", OUTLINE)];
    expect(visibleCrumbs(row).map((c) => c.label)).toEqual(["src", "resolve.ts", "…"]);
  });

  it("is not confused by a file crumb that is named '…'", () => {
    expect(visibleCrumbs([crumb("…", FILE), crumb("a.ts", FILE)]).map((c) => c.label)).toEqual(["…", "a.ts"]);
  });

  it("is wired in the row, and pins what Theia's outline contribution writes", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const row = readFileSync(join(here, "spexr-breadcrumbs-renderer.tsx"), "utf8");
    expect(row).toContain("visibleCrumbs(this.breadcrumbs)");
    const outline = readFileSync(createRequire(import.meta.url).resolve("@theia/outline-view/src/browser/outline-breadcrumbs-contribution.tsx"), "utf8");
    // The ellipsis crumb's label, and the icon class the callable test reads.
    expect(outline).toContain("'…',");
    expect(outline).toContain("'symbol-icon-center codicon codicon-symbol-' + node.iconClass");
  });
});
