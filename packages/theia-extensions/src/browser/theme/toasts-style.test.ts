import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const resolve = createRequire(import.meta.url).resolve;
const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
const theia = (file: string): string => readFileSync(resolve(file), "utf8");
const NOT_HC = ':root:not([data-sl-theme="high-contrast"])';

/** The declarations of the rule whose selector list starts with `selector` (on a line of its own). */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector}`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
}

/** The toasts' section of spexr.css, comments stripped. */
const section = (() => {
  const start = css.indexOf("/* ══ TOASTS AND THE NOTIFICATION CENTER");
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("/* Resource meter hover", start)).replace(/\/\*[\s\S]*?\*\//g, "");
})();

const ITEM = `${NOT_HC} .theia-notification-list-item`;
const TOAST = `${NOT_HC} .theia-notification-toasts .theia-notification-list-item`;
const ROW = `${NOT_HC} .theia-notification-center .theia-notification-list-item`;

// Theia marks a notification's severity only with its glyph's class, and
// knows four: progress wears the info glyph, and there is no success.
describe("Theia's notification", () => {
  it("names its severity on the glyph alone, and knows no success", () => {
    expect(theia("@theia/messages/src/browser/notifications-manager.ts")).toContain("export type Type = 'info' | 'warning' | 'error' | 'progress';");
    const component = theia("@theia/messages/src/browser/notification-component.tsx");
    expect(component).toContain("const icon = type === 'progress' ? 'info' : type;");
    expect(component).toContain("className={`theia-notification-icon ${codicon(icon)} ${icon}`}");
  });

  // No live region and no role: spexr's announcer (messages/toast-announcer.ts)
  // adds the kit's two. If Theia adds its own, the announcer would double it.
  it("carries no role and no live region", () => {
    for (const file of ["notification-component.tsx", "notification-toasts-component.tsx", "notification-center-component.tsx"]) {
      expect(theia(`@theia/messages/src/browser/${file}`), file).not.toMatch(/aria-live|role=|ariaLive/);
    }
  });
});

describe("a toast", () => {
  it("reads its tone off Theia's glyph: info, warning, and error as the kit's danger; neutral otherwise", () => {
    expect(rule(`${ITEM} {`)).toMatch(/--spexr-tone:\s*var\(--slc-text-muted\)/);
    expect(rule(`${ITEM}:has(.theia-notification-icon.info)`)).toMatch(/--spexr-tone:\s*var\(--slc-info-text, var\(--slc-info\)\)/);
    expect(rule(`${ITEM}:has(.theia-notification-icon.warning)`)).toMatch(/--spexr-tone:\s*var\(--slc-warning-text, var\(--slc-warning\)\)/);
    expect(rule(`${ITEM}:has(.theia-notification-icon.error)`)).toMatch(/--spexr-tone:\s*var\(--slc-danger-text, var\(--slc-danger\)\)/);
  });

  it("floats: the raised rung, its border in shade, the float recipe and the large radius", () => {
    const toast = rule(`${TOAST} {`);
    expect(toast).toMatch(/background-color:\s*var\(--slc-raised\)/);
    expect(toast).toMatch(/border:\s*1px solid var\(--slc-edge-raised\)/);
    expect(toast).toMatch(/border-radius:\s*var\(--sl-radius-lg\)/);
    expect(toast).toMatch(/box-shadow:\s*var\(--slc-depth-float\)/);
  });

  it("carries the kit's tone tick on its top edge", () => {
    const tick = rule(`${TOAST}::before {`);
    expect(tick).toMatch(/top:\s*-1px/);
    expect(tick).toMatch(/width:\s*2\.75rem/);
    expect(tick).toMatch(/height:\s*2px/);
    expect(tick).toMatch(/background-color:\s*var\(--spexr-tone\)/);
    expect(tick).toMatch(/calc\(var\(--slc-glow\) \* 100%\)/);
    expect(tick).toMatch(/pointer-events:\s*none/);
  });

  it("washes its glyph in its tone, 24px round", () => {
    const mark = rule(`${NOT_HC} .theia-notification-icon {`);
    expect(mark).toMatch(/color:\s*var\(--spexr-tone\)/);
    expect(mark).toMatch(/background-color:\s*color-mix\(in srgb, currentColor 12%, transparent\)/);
    expect(mark).toMatch(/width:\s*1\.5rem/);
    expect(mark).toMatch(/border-radius:\s*50%/);
  });

  // The kit's arrival: transitions on its motion tokens, which reduced motion
  // zeroes, so the toast then shows at once.
  it("arrives on the kit's motion tokens, and only a toast does", () => {
    const toast = rule(`${TOAST} {`);
    expect(toast).toMatch(/opacity var\(--sl-motion-mid\) var\(--sl-motion-enter, var\(--sl-motion-ease\)\)/);
    expect(toast).toMatch(/translate var\(--sl-motion-mid\) var\(--sl-motion-enter, var\(--sl-motion-ease\)\)/);
    const starts = [...section.matchAll(/@starting-style\s*\{\s*([^{]+)\{/g)].map((m) => m[1]!.trim());
    expect(starts).toEqual([TOAST]);
    // No animation of spexr's own; the only one named is Theia's sweep, stilled.
    expect(section.replace(/@media \(prefers-reduced-motion: reduce\)\s*\{[^{}]*\{\s*animation:\s*none;\s*\}\s*\}/, "")).not.toMatch(/animation/);
    expect(theia("@sondalab/ui-kit/tokens.css")).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{[^}]*--sl-motion-mid:\s*0ms/);
  });

  // Theia's indeterminate progress sweep is an animation of its own, which
  // the kit's tokens do not reach.
  it("stills Theia's indeterminate progress sweep under reduced motion", () => {
    expect(theia("@theia/messages/src/browser/style/notifications.css")).toMatch(/\.theia-notification-item-progressbar\.indeterminate\s*\{[^}]*animation:/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root \.theia-notification-item-progressbar\.indeterminate\s*\{\s*animation:\s*none;/);
    // Above Theia's (0,2,0) on weight, not on sheet order: one class more.
    expect(theia("@theia/messages/src/browser/style/notifications.css")).toMatch(/\n\.theia-notification-item-progressbar\.indeterminate\s*\{/);
  });

  it("keeps its border on a mouse focus, and joins it to the ring on a keyboard one", () => {
    expect(rule(`${TOAST}:focus:not(:focus-visible)`)).toMatch(/border-color:\s*var\(--slc-edge-raised\)/);
    expect(rule(`${TOAST}:focus-visible`)).toMatch(/border-color:\s*var\(--slc-focus\)/);
  });

  it("makes the expand and clear glyphs the kit's small icon buttons, in the one control edge", () => {
    const button = rule(`${NOT_HC} .theia-notification-actions > li {`);
    expect(button).toMatch(/width:\s*1\.5rem/);
    expect(button).toMatch(/height:\s*1\.5rem/);
    expect(button).toMatch(/border:\s*1px solid var\(--slc-edge-control\)/);
    expect(button).toMatch(/color:\s*var\(--slc-text-secondary\)/);
    expect(rule(`${NOT_HC} .theia-notification-actions > li:hover`)).toMatch(/border-color:\s*var\(--slc-edge-control-hover\)/);
  });

  // Theia stacks its toasts column-reverse, newest first, furthest from the
  // corner; the kit's stack puts the newest last, nearest it.
  it("stacks the newest toast nearest the corner", () => {
    expect(theia("@theia/messages/src/browser/style/notifications.css")).toMatch(/\.theia-notification-list\s*\{[^}]*flex-direction:\s*column-reverse/);
    expect(rule(`${NOT_HC} .theia-notification-toasts .theia-notification-list {`)).toMatch(/flex-direction:\s*column;/);
  });

  it("clears the participant's grey from the corners it rounds off", () => {
    expect(rule(`${NOT_HC} .theia-notification-list-item-container {`)).toMatch(/background-color:\s*transparent/);
  });
});

describe("the notification center", () => {
  it("is the toast's surface", () => {
    const center = rule(`${NOT_HC} .theia-notifications-container.theia-notification-center {`);
    expect(center).toMatch(/background-color:\s*var\(--slc-raised\)/);
    expect(center).toMatch(/border:\s*1px solid var\(--slc-edge-raised\)/);
    expect(center).toMatch(/box-shadow:\s*var\(--slc-depth-float\)/);
  });

  it("lists tile rows: a wash on hover, and the focused row a flat tile with the accent seam", () => {
    expect(rule(`${ROW} {`)).toMatch(/border:\s*0/);
    expect(rule(`${ROW}:hover`)).toMatch(/color-mix\(in srgb, var\(--slc-text\) 5%, transparent\)/);
    const focused = rule(`${ROW}:focus-within`);
    expect(focused).toMatch(/background-color:\s*var\(--slc-tile\)/);
    expect(focused).toMatch(/linear-gradient\(var\(--slc-seam\), var\(--slc-seam\)\)/);
    expect(focused).toMatch(/background-size:\s*2px 50%/);
    expect(focused).toMatch(/box-shadow:\s*var\(--slc-depth-flat\)/);
  });
});
