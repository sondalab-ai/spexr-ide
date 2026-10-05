import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const resolve = createRequire(import.meta.url).resolve;
const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
const widget = readFileSync(fileURLToPath(new URL("./spexr-titlebar-widget.tsx", import.meta.url)), "utf8");
const workbench = readFileSync(resolve("@sondalab/ui-kit/workbench.css"), "utf8");
const theiaMenuCss = readFileSync(resolve("@theia/core/src/electron-browser/menu/electron-menu-style.css"), "utf8");

/** The title bar's section of spexr.css, comments stripped. */
const section = (() => {
  const start = css.indexOf("/* ══ THE TITLE BAR");
  expect(start, "the title bar section").toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("/* ══ THE STATUS DOCK", start)).replace(/\/\*[\s\S]*?\*\//g, "");
})();

/** The declarations of the section's rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const start = section.indexOf(`\n${selector} {`);
  expect(start, `${selector} not found in the title bar section`).toBeGreaterThanOrEqual(0);
  return section.slice(section.indexOf("{", start), section.indexOf("}", start));
}

/** The tag of every JSX element in the widget that takes a click: the nearest opening tag before each onClick. */
function clickables(): string[] {
  return [...widget.matchAll(/onClick=/g)].map((m) => {
    const before = widget.slice(0, m.index);
    const tags = [...before.matchAll(/<([a-z]+)\b/g)];
    return tags[tags.length - 1]?.[1] ?? "?";
  });
}

describe("the title bar's drag region", () => {
  // The kit takes these out of the bar's region; a <div onClick> would stay
  // draggable, and the window would move instead of the control answering.
  it("puts every control the widget renders in a <button>, which the kit makes no-drag", () => {
    expect(clickables().length).toBeGreaterThanOrEqual(5);
    expect(new Set(clickables())).toEqual(new Set(["button"]));
    const kitNoDrag = workbench.slice(workbench.indexOf(".sl-titlebar :is("), workbench.indexOf("}", workbench.indexOf(".sl-titlebar :is(")));
    expect(kitNoDrag).toMatch(/:is\(button,/);
    expect(kitNoDrag).toMatch(/-webkit-app-region:\s*no-drag/);
  });

  it("drags on the bar itself, over Theia's no-drag on every child of the panel", () => {
    expect(theiaMenuCss).toMatch(/#theia-top-panel > \*\s*\{\s*-webkit-app-region:\s*no-drag;/);
    expect(rule("#theia-top-panel > .spexr-titlebar-host > .sl-titlebar")).toMatch(/-webkit-app-region:\s*drag/);
    expect(widget).toContain('<header className="sl-titlebar"');
    expect(widget).toContain('this.addClass("spexr-titlebar-host")');
  });

  it("keeps the popups that can overlap the bar out of its region", () => {
    const start = section.indexOf("\n:is(.lm-Menu,");
    expect(start).toBeGreaterThanOrEqual(0);
    const list = section.slice(start, section.indexOf("{", start));
    for (const popup of [".lm-Menu", ".quick-input-widget", ".context-view", ".monaco-hover", ".theia-hover", ".dialogOverlay"]) {
      expect(list, popup).toContain(popup);
    }
    expect(section.slice(start, section.indexOf("}", start))).toMatch(/-webkit-app-region:\s*no-drag/);
  });

  it("leaves Theia's window controls no-drag: they are a child of the panel", () => {
    expect(widget).not.toContain("window-controls");
    expect(rule("#window-controls")).not.toMatch(/app-region/);
  });
});

describe("the title bar's frame", () => {
  it("is the kit's 44px through Theia's menu bar height, on the canvas with no rule under it", () => {
    expect(rule(":root")).toMatch(/--theia-private-menubar-height:\s*44px/);
    const panel = rule("#theia-top-panel");
    expect(panel).toMatch(/background:\s*var\(--slc-canvas\)/);
    expect(panel).toMatch(/border-bottom:\s*0/);
  });

  it("sizes the window controls and the cluster's room for them from one property", () => {
    expect(rule("#theia-top-panel")).toMatch(/--spexr-window-control:\s*48px/);
    expect(rule("#window-controls")).toMatch(/grid-template-columns:\s*repeat\(3, var\(--spexr-window-control\)\)/);
    expect(rule("#theia-top-panel:has(> #window-controls) .sl-titlebar__r")).toMatch(/padding-inline-end:\s*calc\(3 \* var\(--spexr-window-control\)\)/);
  });

  it("never lets the right cluster shrink under the command field", () => {
    expect(rule(".spexr-titlebar-host .sl-titlebar__r")).toMatch(/min-width:\s*max-content/);
  });

  it("hovers the close button in the kit's danger fill and label, with no colour literal", () => {
    expect(rule("#window-controls #close-button:hover")).toMatch(/background:\s*var\(--slc-danger\)/);
    expect(rule("#window-controls #close-button:hover")).toMatch(/color:\s*var\(--slc-on-danger\)/);
    expect(rule("#window-controls #close-button:hover::before")).toMatch(/color:\s*var\(--slc-on-danger\)/);
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });

  it("hides Theia's status-bar notification item: the bell replaces it", () => {
    expect(rule("#theia-statusBar #status-bar-theia-notification-center")).toMatch(/display:\s*none/);
  });
});

// Regression (S5b-1's first Linux capture): the field showed no keycaps.
// The widget is built before Theia registers its default bindings, and that
// registration fires no change event, so the keys are read again once the
// shell attaches. These fail if that ordering, or the missing event, changes.
describe("the command field's keys", () => {
  const app = readFileSync(resolve("@theia/core/lib/browser/frontend-application.js"), "utf8");
  const keybinding = readFileSync(resolve("@theia/core/lib/browser/keybinding.js"), "utf8");
  const body = (source: string, signature: string): string => {
    const start = source.indexOf(`\n    ${signature} {`);
    expect(start, signature).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf("\n    }\n", start));
  };

  it("are read again when the widget attaches", () => {
    const at = widget.indexOf("protected override onAfterAttach(msg: Message): void {");
    expect(at, "SpexrTitleBarWidget.onAfterAttach").toBeGreaterThanOrEqual(0);
    expect(widget.slice(at, widget.indexOf("\n  }\n", at))).toMatch(/super\.onAfterAttach\(msg\);\s*this\.readKeys\(\);/);
  });

  it("which comes after every contribution has started, Theia's key bindings included", () => {
    const start = body(app, "async start()");
    expect(start.indexOf("this.startContributions()")).toBeGreaterThanOrEqual(0);
    expect(start.indexOf("this.startContributions()")).toBeLessThan(start.indexOf("this.attachShell(host);"));
    expect(body(app, "async startContributions()")).toMatch(/await this\.measure\('keybindings\.onStart'/);
  });

  // If Theia starts announcing the registration, the onAfterAttach read can go.
  it("because Theia registers its default bindings without firing onKeybindingsChanged", () => {
    const onStart = body(keybinding, "async onStart()");
    expect(onStart).toContain("contribution.registerKeybindings(this);");
    const afterLayoutListener = onStart.slice(onStart.indexOf("});") + 3);
    expect(afterLayoutListener).not.toContain("keybindingsChanged.fire");
  });
});

describe("the title bar's markup", () => {
  it("uses the kit's parts, the agents badge as a live info badge", () => {
    for (const part of ["sl-titlebar__l", "sl-titlebar__menu", "sl-titlebar__mark", "sl-titlebar__dot", "sl-titlebar__crumb", "sl-titlebar__sep", "sl-titlebar__cmd", "sl-titlebar__cmd-text", "sl-titlebar__keys", "sl-titlebar__r", "sl-titlebar__btn", "sl-titlebar__btn--dot"]) {
      expect(widget, part).toContain(part);
    }
    expect(widget).toContain('"sl-badge sl-badge--info sl-badge--live"');
  });

  it("names each part after its region in the demo's measurements", () => {
    const regions = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../tests/visual/reference/demo-regions.json", import.meta.url)), "utf8")) as {
      themes: { dark: { regions: Record<string, unknown> } };
    };
    const titleRegions = Object.keys(regions.themes.dark.regions).filter((k) => k === "title" || k.startsWith("title."));
    const parity = new Set([...widget.matchAll(/data-parity="([^"]+)"/g)].map((m) => m[1]!));
    // The demo's traffic-light dots are macOS chrome, which S5b-2 draws natively.
    for (const region of titleRegions.filter((r) => !r.startsWith("title.dot"))) expect(parity.has(region), region).toBe(true);
  });
});
