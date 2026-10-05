import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ANNOUNCEMENT_MAX, TOASTS_SHOWN, flattenText, toastAnnouncements, type TextNode, type ToastNote, type ToastUpdate } from "./toast-announcements.js";

const plain = (html: string): string => html.replace(/<[^>]*>/g, "");
const note = (messageId: string, type: ToastNote["type"], message: string): ToastNote => ({ messageId, type, message });
const update = (toasts: ToastNote[], visibilityState: ToastUpdate["visibilityState"] = "toasts"): ToastUpdate => ({ toasts, visibilityState });

/** Runs updates in order, as the announcer does, and returns what each one said. */
function said(updates: ToastUpdate[], silent = false): string[][] {
  let shown = new Set<string>();
  return updates.map((u) => {
    const result = toastAnnouncements(u, shown, silent, plain);
    shown = result.shown;
    return result.announce.map((a) => a.messageId);
  });
}

describe("toastAnnouncements", () => {
  it("says an error in the alert region and everything else in the polite one, as plain text", () => {
    const { announce } = toastAnnouncements(
      update([note("a", "info", "Pushed <b>feat/x</b>."), note("b", "error", "Push failed."), note("c", "warning", "Low power.")]),
      new Set(),
      false,
      plain,
    );
    expect(announce).toEqual([
      { messageId: "a", region: "polite", text: "Pushed feat/x." },
      { messageId: "b", region: "alert", text: "Error: Push failed." },
      { messageId: "c", region: "polite", text: "Warning: Low power." },
    ]);
  });

  // A progress toast updates under the same id and stays on screen.
  it("says a toast once while it stays on screen", () => {
    expect(said([update([note("p", "progress", "Indexing 1%")]), update([note("p", "progress", "Indexing 2%"), note("q", "info", "Done")])])).toEqual([["p"], ["q"]]);
  });

  // Theia names a message by a hash of its type, text and actions: the same
  // message again has the same id, and a timed-out toast stays in the center.
  it("says the same message again when it comes back after leaving the screen", () => {
    const A = note("A", "info", "Pushed.");
    expect(said([update([A]), update([]), update([A])])).toEqual([["A"], [], ["A"]]);
  });

  it("says only the toasts Theia shows, its last three", () => {
    expect(TOASTS_SHOWN).toBe(3);
    const toasts = ["a", "b", "c", "d"].map((id) => note(id, "info", id));
    expect(said([update(toasts)])).toEqual([["b", "c", "d"]]);
  });

  it("says nothing while the toasts are not showing or notifications are silent, and says them once they show", () => {
    const A = note("A", "info", "Hi");
    expect(said([update([A], "center"), update([A], "hidden")])).toEqual([[], []]);
    expect(said([update([A])], true)).toEqual([[]]);
    expect(said([update([A], "center"), update([A])])).toEqual([[], ["A"]]);
  });

  it("says nothing for a toast with no text, and cuts a long one with an ellipsis", () => {
    expect(said([update([note("a", "info", "<br>")])])).toEqual([[]]);
    const { announce } = toastAnnouncements(update([note("a", "info", "x".repeat(5000))]), new Set(), false, plain);
    expect(announce[0]!.text.length).toBe(ANNOUNCEMENT_MAX);
    expect(announce[0]!.text.endsWith("…")).toBe(true);
  });
});

describe("flattenText", () => {
  const text = (content: string): TextNode => ({ nodeType: 3, nodeName: "#text", textContent: content, childNodes: [] });
  const el = (name: string, ...children: TextNode[]): TextNode => ({ nodeType: 1, nodeName: name, textContent: null, childNodes: children });

  it("sets block elements apart and runs inline ones together", () => {
    expect(flattenText(el("BODY", el("P", text("Saved")), el("P", text("3 files"))))).toBe(" Saved  3 files ");
    expect(flattenText(el("BODY", text("Pushed "), el("CODE", text("feat/x")), text(".")))).toBe("Pushed feat/x.");
    expect(flattenText(el("BODY", el("UL", el("LI", text("a")), el("LI", text("b")))))).toMatch(/a\s+b/);
  });
});

// Theia's toast list, and the announcer's wiring and regions (DOM): read from source.
describe("the toast announcer", () => {
  const read = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
  const announcer = read("./toast-announcer.ts");

  it("counts the toasts Theia shows as Theia does", () => {
    const toasts = readFileSync(createRequire(import.meta.url).resolve("@theia/messages/src/browser/notification-toasts-component.tsx"), "utf8");
    expect(toasts).toContain(`toasts: toasts.slice(-${TOASTS_SHOWN}),`);
  });

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

  it("follows the notification manager, minds silent notifications, flattens blocks, and removes what it said", () => {
    expect(announcer).toMatch(/this\.notifications\.onUpdated\(\(update\) => \{\s*const \{ announce, shown \} = toastAnnouncements\(update, this\.shown, !!this\.preferences\["workbench\.silentNotifications"\], plainText\);\s*this\.shown = shown;/);
    expect(announcer).toContain('return flattenText(new DOMParser().parseFromString(html, "text/html").body);');
    expect(announcer).toContain("setTimeout(() => line.remove(), ANNOUNCEMENT_MS);");
  });

  it("is bound as a frontend contribution", () => {
    expect(read("../spexr-frontend-module.ts")).toContain("bind(FrontendApplicationContribution).to(SpexrToastAnnouncer).inSingletonScope();");
  });
});
