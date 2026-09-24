import { describe, expect, it } from "vitest";
import type { SessionLink } from "../../common/darkfactory-protocol.js";
import {
  applyLinks,
  closeBrowser,
  CLOSED_BROWSER,
  navigateBrowser,
  normalizeAddress,
  openBrowser,
  readSplitRatio,
  SPLIT_KEY,
  writeSplitRatio,
} from "./card-browser.js";

const pr = (n: number): SessionLink => ({
  kind: "pr",
  url: `https://github.com/o/r/pull/${n}`,
  label: `PR #${n} · r`,
});
const local: SessionLink = { kind: "local", url: "http://localhost:5173/", label: "localhost:5173" };

describe("card browser state", () => {
  it("opens on the newest link the session produced", () => {
    const s = openBrowser(CLOSED_BROWSER, [pr(2), pr(1)]);
    expect(s.open).toBe(true);
    expect(s.request?.url).toBe(pr(2).url);
  });

  it("opens empty when the session produced no link yet", () => {
    const s = openBrowser(CLOSED_BROWSER, []);
    expect(s.open).toBe(true);
    expect(s.request).toBeUndefined();
  });

  it("reopens on the page it was showing, not the newest link", () => {
    const shown = navigateBrowser(openBrowser(CLOSED_BROWSER, [pr(1)]), "https://example.com/", "typed");
    const reopened = openBrowser(closeBrowser(shown), [pr(2)]);
    expect(reopened.request?.url).toBe("https://example.com/");
  });

  it("follows the session to a new link", () => {
    const s = applyLinks(openBrowser(CLOSED_BROWSER, [pr(1)]), [local, pr(1)]);
    expect(s.request?.url).toBe(local.url);
  });

  it("changes nothing when a refresh brings no new link", () => {
    const s = openBrowser(CLOSED_BROWSER, [pr(1)]);
    expect(applyLinks(s, [pr(1)])).toBe(s);
  });

  it("stops following once the user types an address", () => {
    const typed = navigateBrowser(openBrowser(CLOSED_BROWSER, [pr(1)]), "https://example.com/", "typed");
    expect(applyLinks(typed, [pr(2), pr(1)])).toBe(typed);
  });

  it("resumes following when the user picks one of the session's links", () => {
    const typed = navigateBrowser(openBrowser(CLOSED_BROWSER, [pr(1)]), "https://example.com/", "typed");
    const picked = navigateBrowser(typed, pr(1).url, "picked");
    expect(applyLinks(picked, [pr(2), pr(1)]).request?.url).toBe(pr(2).url);
  });

  it("does not load anything while closed, but shows the newest link on opening", () => {
    const closed = applyLinks(CLOSED_BROWSER, [pr(3)]);
    expect(closed).toBe(CLOSED_BROWSER);
    expect(openBrowser(closed, [pr(3)]).request?.url).toBe(pr(3).url);
  });

  it("asks for a fresh load even when the same page is requested again", () => {
    const a = openBrowser(CLOSED_BROWSER, [pr(1)]);
    const b = navigateBrowser(a, pr(1).url, "picked");
    expect(b.request?.seq).toBeGreaterThan(a.request!.seq);
  });
});

describe("normalizeAddress", () => {
  it("keeps web URLs as typed", () => {
    expect(normalizeAddress(" https://github.com/o/r ")).toBe("https://github.com/o/r");
    expect(normalizeAddress("http://localhost:3000/x")).toBe("http://localhost:3000/x");
  });

  it("adds https to a bare host, and http to a local one", () => {
    expect(normalizeAddress("github.com/o/r")).toBe("https://github.com/o/r");
    expect(normalizeAddress("localhost:5173")).toBe("http://localhost:5173");
    expect(normalizeAddress("127.0.0.1:8080/api")).toBe("http://127.0.0.1:8080/api");
  });

  it("refuses what is not a web address", () => {
    expect(normalizeAddress("")).toBeUndefined();
    expect(normalizeAddress("file:///etc/passwd")).toBeUndefined();
    expect(normalizeAddress("just some words")).toBeUndefined();
  });
});

describe("split ratio", () => {
  const storage = (value?: string) => {
    const values: Record<string, string> = value === undefined ? {} : { [SPLIT_KEY]: value };
    return {
      values,
      getItem: (k: string) => values[k] ?? null,
      setItem: (k: string, v: string) => {
        values[k] = v;
      },
    };
  };

  it("defaults to an even split", () => {
    expect(readSplitRatio(storage())).toBe(0.5);
  });

  it("keeps the stored ratio within 20–80 %", () => {
    expect(readSplitRatio(storage("0.65"))).toBe(0.65);
    expect(readSplitRatio(storage("0.05"))).toBe(0.2);
    expect(readSplitRatio(storage("7"))).toBe(0.8);
    expect(readSplitRatio(storage("nope"))).toBe(0.5);
  });

  it("stores a clamped ratio", () => {
    const s = storage();
    writeSplitRatio(s, 0.95);
    expect(s.values[SPLIT_KEY]).toBe("0.8");
  });
});
