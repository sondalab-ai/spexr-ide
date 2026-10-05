import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LIGHT_SIZE_PROPERTY, LIGHTS_BEFORE_TAHOE, LIGHTS_ROOM_PROPERTY, lightsRoom, TITLE_BAR_HEIGHT, TITLE_BAR_PADDING } from "../../common/mac-title-bar.js";

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

  it("keeps the menu button's room, drawing nothing, until the window's style is known", () => {
    expect(rule(".spexr-titlebar-host .spexr-titlebar__menu--pending")).toMatch(/visibility:\s*hidden/);
    expect(widget).toContain("private menuButton = initialMenuButton(isOSX);");
    expect(widget).toContain('this.menuButton === undefined ? " spexr-titlebar__menu--pending" : ""');
  });

  // .sl-avatar comes after .sl-icon-btn in the kit and would draw the dimmer --slc-border.
  it("draws the avatar's edge at rest in the icon buttons' edge, leaving hover and focus theirs", () => {
    expect(rule(".spexr-titlebar-host .spexr-titlebar__avatar:not(:hover, :focus-visible)")).toMatch(/border-color:\s*var\(--slc-edge-control\)/);
    expect(rule(".spexr-titlebar-host .spexr-titlebar__avatar")).not.toMatch(/border/);
  });

  it("rings a focused window control in the kit's focus colour, inside its edge", () => {
    const ring = rule("#window-controls .control-button:focus-visible");
    expect(ring).toMatch(/outline:\s*var\(--sl-focus-ring-width\) solid var\(--slc-focus\)/);
    expect(ring).toMatch(/outline-offset:\s*calc\(-1 \* var\(--sl-focus-ring-width\)\)/);
  });

  // On the danger fill the focus colour reads 1.09:1 (ink) and 1.68:1 (paper).
  it("rings the hovered close button in the danger fill's label", () => {
    expect(rule("#window-controls #close-button:hover:focus-visible")).toMatch(/outline-color:\s*var\(--slc-on-danger\)/);
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

  // A panel disclosure, as the bell is: it rests like the demo's, with no pressed tint.
  it("discloses the right panel with aria-expanded and aria-controls, never aria-pressed", () => {
    const split = widget.slice(widget.indexOf('aria-label="Right panel"'), widget.indexOf('data-parity="title.split"'));
    expect(split).toContain("aria-expanded={this.rightOpen}");
    expect(split).toContain("aria-controls={this.rightPanelId}");
    // The dock panel aria-expanded follows, by its own id (theia-right-side-panel).
    expect(widget).toMatch(/const dock = this\.shell\.rightPanelHandler\.dockPanel;\s*this\.rightPanelId = dock\.id;/);
    const sidePanel = readFileSync(resolve("@theia/core/lib/browser/shell/side-panel-handler.js"), "utf8");
    expect(sidePanel).toContain("sidePanel.id = 'theia-' + this.side + '-side-panel';");
    expect(sidePanel).toContain("this.dockPanel = this.createSidePanel();");
    expect(widget).not.toContain("aria-pressed");
  });

  // The crumb drags the window, so a title tooltip on it never shows.
  it("gives the crumb its full path as text for a screen reader, not as a tooltip", () => {
    const crumb = widget.slice(widget.indexOf('<span className="sl-titlebar__crumb"'), widget.indexOf("</div>", widget.indexOf('<span className="sl-titlebar__crumb"')));
    expect(crumb).not.toMatch(/\btitle=/);
    expect(crumb).toContain('<span aria-hidden="true">');
    expect(crumb).toContain('<span className="spexr-sr-only">{this.crumbName}</span>');
  });

  it("names the avatar after the initials it shows", () => {
    expect(widget).toContain("aria-label={avatarLabel(monogram)}");
  });

  it("names each part after its region in the demo's measurements", () => {
    const regions = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../tests/visual/reference/demo-regions.json", import.meta.url)), "utf8")) as {
      themes: { dark: { regions: Record<string, unknown> } };
    };
    const titleRegions = Object.keys(regions.themes.dark.regions).filter((k) => k === "title" || k.startsWith("title."));
    const parity = new Set([...widget.matchAll(/data-parity="([^"]+)"/g)].map((m) => m[1]!));
    // The demo's dots are macOS's traffic lights, which the system draws: the
    // bar has their room as one part (title.dots), not a part per light.
    for (const region of titleRegions.filter((r) => r !== "title.dot")) expect(parity.has(region), region).toBe(true);
  });
});

describe("the room for macOS's traffic lights", () => {
  const kitBar = workbench.slice(workbench.indexOf("\n.sl-titlebar {"), workbench.indexOf("}", workbench.indexOf("\n.sl-titlebar {")));
  const kitTracks = workbench.slice(workbench.indexOf("\n.sl-titlebar__l,"), workbench.indexOf("}", workbench.indexOf("\n.sl-titlebar__l,")));

  // The main process places the lights from common/mac-title-bar.ts and
  // sets the room for the zoom; the span has to cover the same pixels, or
  // the mark lands on the lights.
  it("is a span as wide and tall as the main process says, the lights before macOS 26 at 100% until it does", () => {
    const lights = rule(".spexr-titlebar-host .spexr-titlebar__lights");
    expect(LIGHTS_ROOM_PROPERTY).toBe("--spexr-traffic-lights");
    expect(LIGHT_SIZE_PROPERTY).toBe("--spexr-traffic-light-size");
    expect(lights).toContain(`width: var(${LIGHTS_ROOM_PROPERTY}, ${lightsRoom(LIGHTS_BEFORE_TAHOE, 1)}px);`);
    expect(lights).toContain(`height: var(${LIGHT_SIZE_PROPERTY}, ${LIGHTS_BEFORE_TAHOE.circle.size}px);`);
    expect(lights).toMatch(/flex:\s*none/);
  });

  // A declaration on any element between :root and the span would win over
  // the values the main process sets on :root.
  it("never declares the main process's properties itself", () => {
    for (const property of [LIGHTS_ROOM_PROPERTY, LIGHT_SIZE_PROPERTY]) expect(css, property).not.toMatch(new RegExp(`${property}\\s*:`));
  });

  // The span is the lights' place in the drag region: no-drag there would
  // make the strip beside the lights unmovable.
  it("stays in the drag region", () => {
    expect(rule(".spexr-titlebar-host .spexr-titlebar__lights")).not.toMatch(/app-region/);
    expect(section).not.toMatch(/spexr-titlebar__lights[^{]*\{[^}]*app-region:\s*no-drag/);
  });

  it("starts where the lights start: the kit's bar padding, on a bar of the lights' height", () => {
    expect(TITLE_BAR_PADDING).toBe(16);
    expect(kitBar).toMatch(/padding-inline:\s*var\(--sl-space-4, 1rem\)/);
    expect(kitBar).toContain(`height: ${TITLE_BAR_HEIGHT}px;`);
    expect(kitBar).toMatch(/align-items:\s*center/);
    expect(kitTracks).toMatch(/align-items:\s*center/);
  });

  // Room on the bar's own padding, as the kit's note suggests, would move
  // the centre track; inside the left track it leaves the field centred.
  it("sits first in the left track, before the mark, never on the bar's padding", () => {
    expect(section).not.toMatch(/\.sl-titlebar\s*\{[^}]*padding/);
    const start = widget.indexOf('<div className="sl-titlebar__l"');
    const end = widget.indexOf("{this.menuButton !== false && (", start);
    expect(start, "the left track").toBeGreaterThanOrEqual(0);
    expect(end, "the menu button after it").toBeGreaterThan(start);
    const left = widget.slice(start, end);
    expect(left).toContain('<span className="spexr-titlebar__lights" aria-hidden="true" data-parity="title.dots" />');
    const span = widget.indexOf('className="spexr-titlebar__lights"');
    const mark = widget.indexOf('className="sl-titlebar__mark"');
    const right = widget.indexOf('<div className="sl-titlebar__r"');
    expect(mark, "the mark").toBeGreaterThan(span);
    expect(right, "the right track").toBeGreaterThan(mark);
  });

  it("is on from the first paint on macOS, and the bar answers the full-screen watch", () => {
    expect(widget).toContain("private trafficLights = trafficLightInset(isOSX, false);");
    expect(widget).toMatch(/setTrafficLights\(shown: boolean\): void \{\s*if \(this\.trafficLights === shown\) return;\s*this\.trafficLights = shown;\s*this\.update\(\);/);
  });
});
