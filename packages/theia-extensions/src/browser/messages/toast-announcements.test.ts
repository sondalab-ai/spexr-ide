import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toastAnnouncements, type ToastNote, type ToastUpdate } from "./toast-announcements.js";

const plain = (html: string): string => html.replace(/<[^>]*>/g, "");
const note = (messageId: string, type: ToastNote["type"], message: string): ToastNote => ({ messageId, type, message });
const update = (toasts: ToastNote[], visibilityState: ToastUpdate["visibilityState"] = "toasts", extra: string[] = []): ToastUpdate => ({
  toasts,
  notifications: [...toasts, ...extra.map((messageId) => ({ messageId }))],
  visibilityState,
});

describe("toastAnnouncements", () => {
  it("says an error in the alert region and everything else in the polite one, as plain text", () => {
    const { announce } = toastAnnouncements(
      update([note("a", "info", "Pushed <b>feat/x</b>."), note("b", "error", "Push failed."), note("c", "warning", "Low power."), note("d", "progress", "Indexing")]),
      new Set(),
      false,
      plain,
    );
    expect(announce).toEqual([
      { messageId: "a", region: "polite", text: "Pushed feat/x." },
      { messageId: "b", region: "alert", text: "Error: Push failed." },
      { messageId: "c", region: "polite", text: "Warning: Low power." },
      { messageId: "d", region: "polite", text: "Indexing" },
    ]);
  });

  // A progress toast updates under the same id: it is read once.
  it("says each toast once", () => {
    const first = toastAnnouncements(update([note("p", "progress", "Indexing 1%")]), new Set(), false, plain);
    const second = toastAnnouncements(update([note("p", "progress", "Indexing 2%"), note("q", "info", "Done")]), first.seen, false, plain);
    expect(first.announce.map((a) => a.messageId)).toEqual(["p"]);
    expect(second.announce.map((a) => a.messageId)).toEqual(["q"]);
  });

  it("says nothing while the toasts are not showing or notifications are silent, and never says those later", () => {
    const center = toastAnnouncements(update([note("a", "info", "Hi")], "center"), new Set(), false, plain);
    const silent = toastAnnouncements(update([note("b", "error", "Oops")]), new Set(), true, plain);
    expect(center.announce).toEqual([]);
    expect(silent.announce).toEqual([]);
    expect(toastAnnouncements(update([note("a", "info", "Hi")]), center.seen, false, plain).announce).toEqual([]);
  });

  it("forgets an id once it has left the notifications, and keeps one that is still listed", () => {
    const { seen } = toastAnnouncements(update([], "toasts", ["kept"]), new Set(["gone", "kept"]), false, plain);
    expect([...seen]).toEqual(["kept"]);
  });

  it("says nothing for a toast with no text", () => {
    expect(toastAnnouncements(update([note("a", "info", "<br>")]), new Set(), false, plain).announce).toEqual([]);
  });
});

// The announcer's wiring and its regions are DOM: read from source.
describe("the toast announcer", () => {
  const read = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
  const announcer = read("./toast-announcer.ts");

  it("makes two sibling regions at start, polite and alert, visually hidden but never display: none", () => {
    expect(announcer).toContain('polite.setAttribute("aria-live", "polite");');
    expect(announcer).toContain('alert.setAttribute("role", "alert");');
    expect(announcer).toContain("document.body.append(polite, alert);");
    const css = read("../style/spexr.css");
    const start = css.indexOf("\n.spexr-sr-only {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(rule).not.toMatch(/display:\s*none/);
  });

  it("follows the notification manager, minds silent notifications, and removes what it said", () => {
    expect(announcer).toMatch(/this\.notifications\.onUpdated\(\(update\) => \{\s*const \{ announce, seen \} = toastAnnouncements\(update, this\.seen, !!this\.preferences\["workbench\.silentNotifications"\], plainText\);/);
    expect(announcer).toContain("setTimeout(() => line.remove(), ANNOUNCEMENT_MS);");
  });

  it("is bound as a frontend contribution", () => {
    expect(read("../spexr-frontend-module.ts")).toContain("bind(FrontendApplicationContribution).to(SpexrToastAnnouncer).inSingletonScope();");
  });
});
