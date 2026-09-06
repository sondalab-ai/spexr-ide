import { describe, expect, it } from "vitest";
import { httpsHref } from "./external-link.js";

describe("httpsHref", () => {
  it("accepts an https url", () => {
    expect(httpsHref("https://example.com/a?b=c#d")).toBe("https://example.com/a?b=c#d");
  });

  it("rejects plain http", () => {
    expect(httpsHref("http://example.com")).toBeUndefined();
  });

  it("rejects a javascript url", () => {
    expect(httpsHref("javascript:alert(1)")).toBeUndefined();
  });

  it("rejects a javascript url disguised by case and whitespace", () => {
    expect(httpsHref(" JaVaScRiPt:alert(1)")).toBeUndefined();
  });

  it("rejects a data url", () => {
    expect(httpsHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
  });

  it("rejects a local file url", () => {
    expect(httpsHref("file:///etc/passwd")).toBeUndefined();
  });

  it("rejects a relative path", () => {
    expect(httpsHref("/docs/spec.md")).toBeUndefined();
  });

  it("rejects an empty string", () => {
    expect(httpsHref("")).toBeUndefined();
  });
});
