import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { UriWatchers } from "./uri-watchers.js";

/** A subscription that records whether it is live. */
function sub(): { live: boolean; dispose(): void } {
  const s = { live: true, dispose: () => void (s.live = false) };
  return s;
}

describe("the editors watched per file (E7)", () => {
  it("keeps a copy's subscriptions when the original is closed: only the closed editor's go", () => {
    const watchers = new UriWatchers<string>();
    const original = [sub(), sub()];
    const copy = [sub(), sub()];
    expect(watchers.add("file:///a.ts", "original", () => original)).toBe(true);
    expect(watchers.add("file:///a.ts", "copy", () => copy)).toBe(false);
    expect(watchers.remove("file:///a.ts", "original")).toBe(false);
    expect(original.map((s) => s.live)).toEqual([false, false]);
    expect(copy.map((s) => s.live)).toEqual([true, true]);
    expect(watchers.widgets("file:///a.ts")).toEqual(["copy"]);
  });

  it("says the file is free when its last editor goes, and forgets it", () => {
    const watchers = new UriWatchers<string>();
    const only = [sub()];
    watchers.add("u", "w", () => only);
    expect(watchers.remove("u", "w")).toBe(true);
    expect(only[0]!.live).toBe(false);
    expect(watchers.uris()).toEqual([]);
    expect(watchers.remove("u", "w")).toBe(false);
  });

  it("subscribes an editor once, however often it is added", () => {
    const watchers = new UriWatchers<string>();
    let made = 0;
    watchers.add("u", "w", () => (made++, []));
    watchers.add("u", "w", () => (made++, []));
    expect(made).toBe(1);
  });

  it("is wired per editor in the service: each widget subscribes to its own document", () => {
    const source = readFileSync(fileURLToPath(new URL("./breadcrumb-meta-service.ts", import.meta.url)), "utf8");
    expect(source).toContain("this.watchers.add(uri, widget, () => {");
    expect(source).toContain("widget.editor.onDocumentContentChanged(");
    expect(source).toContain("widget.disposed.connect(() => this.unwatch(uri, widget))");
  });
});
