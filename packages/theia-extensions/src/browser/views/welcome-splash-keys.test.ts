import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WelcomeSplash, type WelcomeSplashProps } from "./welcome-splash.js";
import { keyCaps } from "./key-caps.js";

const noop = (): void => undefined;

/** The "Talk to the agent" card's button, as the splash renders it. */
function agentCard(props: Partial<WelcomeSplashProps>): string {
  const html = renderToStaticMarkup(
    React.createElement(WelcomeSplash, { onNewProject: noop, onOpenFolder: noop, onFocusAgent: noop, ...props }),
  );
  const start = html.lastIndexOf("<button", html.indexOf("Talk to the agent"));
  return html.slice(start, html.indexOf("</button>", start));
}

describe("the welcome card's shortcut", () => {
  // ⌘⇧A was printed on the card as one cap, and no key was ever bound to the
  // command; the card now shows the keys the registry has, or none.
  it("shows no keys when none is bound", () => {
    const card = agentCard({});
    expect(card).not.toContain("<kbd");
    expect(card).not.toContain("aria-keyshortcuts");
    expect(card).not.toContain("⌘");
  });

  it("shows one cap per key, hidden from the name, and names the shortcut on the button", () => {
    const caps = keyCaps([{ ctrl: false, shift: true, alt: false, meta: true, label: "A", code: "KeyA" }], "mac");
    const card = agentCard({ agentShortcut: caps });
    expect(card).toContain('aria-keyshortcuts="Shift+Meta+A"');
    expect([...card.matchAll(/<kbd class="sl-kbd">([^<]*)<\/kbd>/g)].map((m) => m[1])).toEqual(["⇧", "⌘", "A"]);
    expect(card).toMatch(/<span class="spexr-welcome-card__keys" aria-hidden="true">/);
  });
});
