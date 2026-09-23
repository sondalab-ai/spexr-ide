import { describe, expect, it } from "vitest";
import { hardenWebviewAttach, isWebUrl } from "./webview-policy.js";

describe("isWebUrl", () => {
  it("accepts http and https", () => {
    expect(isWebUrl("https://github.com/o/r/pull/1")).toBe(true);
    expect(isWebUrl("http://localhost:5173/")).toBe(true);
  });

  it("rejects local files, custom schemes and garbage", () => {
    expect(isWebUrl("file:///etc/passwd")).toBe(false);
    expect(isWebUrl("vscode://open")).toBe(false);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl("not a url")).toBe(false);
  });
});

describe("hardenWebviewAttach", () => {
  it("strips a preload and Node access, and sandboxes the guest", () => {
    const prefs: Record<string, unknown> = {
      preload: "/evil.js",
      preloadURL: "file:///evil.js",
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
    };
    expect(hardenWebviewAttach(prefs, { src: "https://github.com" })).toBe(true);
    expect(prefs).toEqual({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    });
  });

  it("allows an empty guest, which the card creates before it has a page", () => {
    expect(hardenWebviewAttach({}, {})).toBe(true);
    expect(hardenWebviewAttach({}, { src: "about:blank" })).toBe(true);
  });

  it("refuses a guest whose source is not a web page", () => {
    expect(hardenWebviewAttach({}, { src: "file:///Users/me/.ssh/id_rsa" })).toBe(false);
  });
});
