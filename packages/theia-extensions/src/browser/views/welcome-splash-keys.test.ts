import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WelcomeSplash, type WelcomeSplashProps } from "./welcome-splash.js";
import { keyCaps } from "./key-caps.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

  // Owner decision (S4): no ⌘⇧A is promised, so no key is bound and no startup
  // tip names one. The kit's tips are read as source to keep the kit out of the test's build.
  it("promises no ⌘⇧A in the startup tips, and binds no ctrlcmd+shift+a", () => {
    const repo = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
    const tips = readFileSync(join(repo, "packages/ui-kit/src/data/tips.ts"), "utf8");
    expect(tips).not.toMatch(/⌘⇧A|shortcut-agent|shift \+ A/i);
    const contribution = readFileSync(join(repo, "packages/theia-extensions/src/browser/commands/spexr-commands-contribution.ts"), "utf8");
    expect(contribution).not.toMatch(/ctrlcmd\+shift\+a/i);
  });
});
