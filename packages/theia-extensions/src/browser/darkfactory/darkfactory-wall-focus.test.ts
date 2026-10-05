import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./darkfactory-wall-widget.tsx", import.meta.url)), "utf8");

// Selecting the Darkfactory tab moved no DOM focus: the shell's focus tracker
// never fired, so the lit island stayed on the pane focused before, and the
// keyboard never reached the wall.
describe("the Darkfactory wall", () => {
  it("is focusable from script but not a tab stop", () => {
    expect(src).toMatch(/this\.node\.tabIndex = -1;/);
  });

  it("takes the focus when the shell activates it, without scrolling", () => {
    const at = src.indexOf("protected override onActivateRequest(msg: Message): void {");
    expect(at, "onActivateRequest override").toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf("\n  }\n", at));
    expect(body).toMatch(/super\.onActivateRequest\(msg\);[\s\S]*this\.node\.focus\(\{ preventScroll: true \}\);/);
  });

  // Theia's :focus rule frames a focused widget node in the focus border; the
  // lit island already marks the focus, so a mouse activation draws no frame.
  it("draws no focus frame on a mouse activation, and keeps it for the keyboard", () => {
    const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
    expect(css).toMatch(/\n\.spexr-darkfactory:focus:not\(:focus-visible\) \{\s*outline: none;\s*\}/);
    expect(css).not.toMatch(/\.spexr-darkfactory:focus-visible \{[^}]*outline: none/);
  });
});
