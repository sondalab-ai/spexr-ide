import { describe, expect, it } from "vitest";
import {
  themeReport,
  trackThemeReports,
  type CsiHandler,
  type CsiParserLike,
} from "./terminal-theme-report.js";

/** A parser stand-in that feeds `CSI ? … h/l` sequences to the registered handlers, like xterm's. */
function fakeParser(): CsiParserLike & { feed(final: "h" | "l", ...params: number[]): boolean[]; live: number } {
  const handlers: { final: string; prefix?: string; callback: CsiHandler }[] = [];
  return {
    get live() {
      return handlers.length;
    },
    registerCsiHandler(id, callback) {
      const entry = { ...id, callback };
      handlers.push(entry);
      return { dispose: () => void handlers.splice(handlers.indexOf(entry), 1) };
    },
    feed(final, ...params) {
      return handlers.filter((h) => h.prefix === "?" && h.final === final).map((h) => h.callback(params));
    },
  };
}

describe("trackThemeReports", () => {
  it("is off until the program sets mode 2031", () => {
    const parser = fakeParser();
    const tracker = trackThemeReports(parser);
    expect(tracker.enabled).toBe(false);
    parser.feed("h", 2031);
    expect(tracker.enabled).toBe(true);
  });

  it("turns off when the program resets mode 2031", () => {
    const parser = fakeParser();
    const tracker = trackThemeReports(parser);
    parser.feed("h", 2031);
    parser.feed("l", 2031);
    expect(tracker.enabled).toBe(false);
  });

  it("finds 2031 among several modes in one sequence and ignores other modes", () => {
    const parser = fakeParser();
    const tracker = trackThemeReports(parser);
    parser.feed("h", 1000, 1006);
    expect(tracker.enabled).toBe(false);
    parser.feed("h", 2004, 2031);
    expect(tracker.enabled).toBe(true);
    parser.feed("l", 1000);
    expect(tracker.enabled).toBe(true);
  });

  it("leaves every sequence to xterm's own handling", () => {
    const parser = fakeParser();
    trackThemeReports(parser);
    expect(parser.feed("h", 2031)).toEqual([false]);
    expect(parser.feed("l", 25)).toEqual([false]);
  });

  it("removes its handlers on dispose", () => {
    const parser = fakeParser();
    trackThemeReports(parser).dispose();
    expect(parser.live).toBe(0);
  });
});

describe("themeReport", () => {
  it("encodes dark as 1 and light as 2", () => {
    expect(themeReport(true)).toBe("\x1b[?997;1n");
    expect(themeReport(false)).toBe("\x1b[?997;2n");
  });
});

