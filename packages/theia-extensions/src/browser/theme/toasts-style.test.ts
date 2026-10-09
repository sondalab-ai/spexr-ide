import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { TOAST, WORKBENCH } from "../shell/workbench-geometry.js";
import { EDITOR_ANCHOR_VARS } from "../shell/editor-anchor.js";
import { contrastRatio, over } from "./contrast-util.js";

const resolve = createRequire(import.meta.url).resolve;
const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
const theia = (file: string): string => readFileSync(resolve(file), "utf8");
const NOT_HC = ':root:not([data-sl-theme="high-contrast"])';
const kitFile = (name: string): string => readFileSync(join(dirname(resolve("@sondalab/ui-kit/effects.js")), name), "utf8");

/** A length of a declaration as px (`32px`, or `2rem` at the kit's 16px to the rem). */
function px(body: string, name: string): number {
  const m = new RegExp(`(?:^|[\\s;{])${name}:\\s*([\\d.]+)(px|rem)`).exec(body);
  expect(m, `${name} in ${body.slice(0, 160)}`).not.toBeNull();
  return Number(m![1]) * (m![2] === "rem" ? 16 : 1);
}

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
  return css.slice(start, css.indexOf("/* ══ THE COMMAND PALETTE", start)).replace(/\/\*[\s\S]*?\*\//g, "");
})();

const ITEM = `${NOT_HC} .theia-notification-list-item`;
const TOAST_ITEM = `${NOT_HC} .theia-notification-toasts .theia-notification-list-item`;
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

  it("floats: the raised rung, no border, the cast and r12", () => {
    const toast = rule(`${TOAST_ITEM} {`);
    expect(toast).toMatch(/background-color:\s*var\(--slc-raised\)/);
    expect(toast).toMatch(/border:\s*0;/);
    expect(toast).toMatch(new RegExp(`border-radius:\\s*${TOAST.radius}px`));
    expect(toast).toMatch(/box-shadow:\s*var\(--slc-depth-cast\)/);
    expect(kitFile("components.css")).toMatch(new RegExp(`\\.sl-toast \\{[^}]*border: 0;[^}]*border-radius: ${TOAST.radius}px;[^}]*box-shadow: var\\(--slc-depth-cast\\)`));
  });

  it("carries the kit's tone tick on its top edge: 1px, from 16px in to the middle, fading, glowing at 50%", () => {
    const tick = rule(`${TOAST_ITEM}::before {`);
    expect(tick).toMatch(/top:\s*0;/);
    expect(tick).toMatch(/left:\s*var\(--sl-space-4\);/);
    expect(TOAST.paddingStart).toBe(16);
    expect(tick).toMatch(/right:\s*50%/);
    expect(px(tick, "height")).toBe(1);
    expect(tick).toMatch(/background-image:\s*linear-gradient\(90deg, var\(--spexr-tone\), transparent\)/);
    expect(tick).toMatch(/box-shadow:\s*0 0 10px color-mix\(in srgb, var\(--spexr-tone\) calc\(50% \* min\(1, var\(--slc-glow\) \* 1000\)\), transparent\)/);
    expect(tick).toMatch(/pointer-events:\s*none/);
    expect(kitFile("components.css")).toMatch(/\.sl-toast::before \{[^}]*inset-inline: var\(--sl-space-4, 1rem\) 50%;[^}]*height: 1px;[^}]*calc\(50% \* min\(1, var\(--slc-glow\) \* 1000\)\)/);
  });

  it("washes its glyph in its tone at 16%, 24px round", () => {
    const mark = rule(`${NOT_HC} .theia-notification-icon {`);
    expect(mark).toMatch(/color:\s*var\(--spexr-tone\)/);
    expect(mark).toMatch(/background-color:\s*color-mix\(in srgb, currentColor 16%, transparent\)/);
    expect(px(mark, "width")).toBe(TOAST.mark);
    expect(px(mark, "height")).toBe(TOAST.mark);
    expect(mark).toMatch(/border-radius:\s*50%/);
  });

  it("pads its row 12px above and at the end, 16px below and at the start, with 12px between the glyph, the words and the buttons", () => {
    const row = rule(`${NOT_HC} .theia-notification-list-item-content {`);
    expect(row).toMatch(new RegExp(`padding:\\s*var\\(--sl-space-3\\) var\\(--sl-space-3\\) var\\(--sl-space-4\\) var\\(--sl-space-4\\)`));
    expect([TOAST.paddingTop, TOAST.paddingEnd, TOAST.paddingBottom, TOAST.paddingStart]).toEqual([12, 12, 16, 16]);
    expect(rule(`${NOT_HC} .theia-notification-list-item-content-main {`)).toMatch(/gap:\s*var\(--sl-space-3\)/);
    expect(TOAST.gap).toBe(12);
  });

  // The kit's arrival: transitions on its motion tokens, which reduced motion
  // zeroes, so the toast then shows at once.
  it("arrives on the kit's motion tokens, and only a toast does", () => {
    const toast = rule(`${TOAST_ITEM} {`);
    expect(toast).toMatch(/opacity var\(--sl-motion-mid\) var\(--sl-motion-enter, var\(--sl-motion-ease\)\)/);
    expect(toast).toMatch(/translate var\(--sl-motion-mid\) var\(--sl-motion-enter, var\(--sl-motion-ease\)\)/);
    const starts = [...section.matchAll(/@starting-style\s*\{\s*([^{]+)\{/g)].map((m) => m[1]!.trim());
    expect(starts).toEqual([TOAST_ITEM]);
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

  it("makes the expand and clear glyphs the kit's icon buttons, 32px at r8, in the one control edge", () => {
    const button = rule(`${NOT_HC} .theia-notification-actions > li {`);
    expect(px(button, "width")).toBe(TOAST.dismiss);
    expect(px(button, "height")).toBe(TOAST.dismiss);
    expect(button).toMatch(/border:\s*1px solid var\(--slc-edge-control\)/);
    expect(button).toMatch(/border-radius:\s*var\(--sl-radius-md\)/);
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

describe("where the toasts float", () => {
  it("ends 8px inside the editor island's right edge, which the shell publishes, not the window's", () => {
    const stack = rule("body .theia-notifications-container {");
    expect(stack).toContain(`right: calc(var(${EDITOR_ANCHOR_VARS.end}) + ${TOAST.inset}px);`);
    expect(stack).toContain(`max-width: calc(var(${EDITOR_ANCHOR_VARS.width}) - ${2 * TOAST.inset}px);`);
    expect(theia("@theia/messages/src/browser/style/notifications.css")).toMatch(/\.theia-notifications-container \{\s*position: absolute;\s*bottom: 36px;\s*right: 16px;/);
  });

  it("sits 48px above the window's bottom, the table's toast offset", () => {
    expect(px(rule("body .theia-notifications-container {"), "bottom")).toBe(WORKBENCH.toastOffset);
  });

  it("is the demo's 360px card; the center keeps Theia's width", () => {
    expect(px(rule("body .theia-notifications-container.theia-notification-toasts {"), "width")).toBe(TOAST.width);
  });
});

describe("the notification center", () => {
  it("is the toast's surface", () => {
    const center = rule(`${NOT_HC} .theia-notifications-container.theia-notification-center {`);
    expect(center).toMatch(/background-color:\s*var\(--slc-raised\)/);
    expect(center).toMatch(/border:\s*0;/);
    expect(center).toMatch(new RegExp(`border-radius:\\s*${TOAST.radius}px`));
    expect(center).toMatch(/box-shadow:\s*var\(--slc-depth-cast\)/);
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

type Theme = "dark" | "light";
const neutrals = kitNeutrals.products.spexr as unknown as Record<Theme, Record<string, string>>;
const statusFile = (theme: Theme): string => kitFile(`themes/${theme}.css`);
const status = (theme: Theme, tone: "info" | "warning" | "danger"): string => new RegExp(`--sl-status-${tone}:\\s*(#[0-9a-f]{6})`).exec(statusFile(theme))![1]!;

// The owner's rules: text at least 4.5:1. A toast is the raised rung; its mark
// is the tone's ink on a 16% wash of itself, which only a glyph sits on.
describe.each(["dark", "light"] as const)("a toast's text on %s", (theme) => {
  const raised = neutrals[theme]["bg-surface-raised"]!;
  const ink = (key: string): string => neutrals[theme][key]!;

  it("reads the message (the primary ink) and the source (the muted ink) at 4.5:1 on the raised rung", () => {
    expect(contrastRatio(ink("text-primary"), raised), "message").toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ink("text-muted"), raised), "source").toBeGreaterThanOrEqual(4.5);
  });

  it("reads each tone's glyph on its own 16% wash over the raised rung at 3:1, and the neutral one at 4.5:1", () => {
    for (const tone of ["info", "warning", "danger"] as const) {
      const glyph = status(theme, tone);
      expect(contrastRatio(glyph, over(`${glyph}29`, raised)), tone).toBeGreaterThanOrEqual(3);
    }
    const muted = ink("text-muted");
    expect(contrastRatio(muted, over(`${muted}29`, raised)), "neutral").toBeGreaterThanOrEqual(4.5);
  });

  it("reads the expand and clear glyphs (the secondary ink) at 4.5:1 on the raised rung", () => {
    expect(contrastRatio(ink("text-secondary"), raised)).toBeGreaterThanOrEqual(4.5);
  });
});
