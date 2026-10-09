import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Weight = [number, number, number];

const resolve = createRequire(import.meta.url).resolve;
const spexr = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
const kit = readFileSync(resolve("@sondalab/ui-kit/components.css"), "utf8");

/** Top-level comma split (commas inside :is() / :not() / :has() stay). */
function splitList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

const add = (a: Weight, b: Weight): Weight => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cmp = (a: Weight, b: Weight): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const max = (ws: Weight[]): Weight => ws.reduce((m, w) => (cmp(w, m) > 0 ? w : m), [0, 0, 0]);

/**
 * Selectors Level 4 specificity of one complex selector: ids, then classes,
 * attributes and pseudo-classes, then types and pseudo-elements. :is(),
 * :not() and :has() weigh their heaviest argument; :where() weighs nothing.
 */
function specificity(selector: string): Weight {
  let w: Weight = [0, 0, 0];
  let i = 0;
  const ident = (): string => {
    const m = /^-?[\w-]+/.exec(selector.slice(i));
    i += m ? m[0].length : 0;
    return m ? m[0] : "";
  };
  while (i < selector.length) {
    const ch = selector[i]!;
    if (ch === "#") { i++; ident(); w = add(w, [1, 0, 0]); }
    else if (ch === ".") { i++; ident(); w = add(w, [0, 1, 0]); }
    else if (ch === "[") { i = selector.indexOf("]", i) + 1; w = add(w, [0, 1, 0]); }
    else if (ch === ":" && selector[i + 1] === ":") { i += 2; ident(); w = add(w, [0, 0, 1]); }
    else if (ch === ":") {
      i++;
      const name = ident();
      if (selector[i] === "(") {
        let depth = 0;
        const open = i;
        for (; i < selector.length; i++) {
          if (selector[i] === "(") depth++;
          else if (selector[i] === ")" && --depth === 0) break;
        }
        const args = selector.slice(open + 1, i);
        i++;
        if (name === "where") continue;
        if (["is", "not", "has"].includes(name)) w = add(w, max(splitList(args).map(specificity)));
        else w = add(w, [0, 1, 0]);
      } else w = add(w, [0, 1, 0]);
    } else if (/[a-zA-Z]/.test(ch)) { ident(); w = add(w, [0, 0, 1]); }
    else i++;
  }
  return w;
}

/** Every selector in `css` (comments stripped) that `test` accepts. */
function selectors(css: string, test: (s: string) => boolean): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...clean.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap((m) => splitList(m[1]!.replace(/\s+/g, " ")))
    .filter(test);
}

describe("the specificity helper", () => {
  it("weighs the shapes these tests compare", () => {
    expect(specificity(".sl-switch:active:not(:has(:disabled)) .sl-switch__track::after")).toEqual([0, 4, 1]);
    expect(specificity(':root:not([data-sl-theme="high-contrast"]) #a .b')).toEqual([1, 3, 0]);
    expect(specificity(":where(.a, .b) .c")).toEqual([0, 1, 0]);
    expect(specificity("body.x #y .z")).toEqual([1, 2, 1]);
  });
});

// The kit's held switch rules (0.32) outrank a plain knob rule; the compact
// switch resizes its held knob under its own class, so its rules must outrank
// the kit's, whatever the kit's weights become.
describe("the compact switch's held rules", () => {
  const kitHeld = selectors(kit, (s) => s.startsWith(".sl-switch:active") && s.endsWith(".sl-switch__track::after"));
  const ours = selectors(spexr, (s) => s.startsWith(".spexr-df-switch.sl-switch:active") && s.endsWith(".sl-switch__track::after"));

  it("finds the kit's two held rules and spexr's two", () => {
    expect(kitHeld).toHaveLength(2);
    expect(ours).toHaveLength(2);
  });

  it.each([false, true])("outrank the kit's (checked: %s)", (checked) => {
    const pick = (list: string[]): string => list.find((s) => s.includes(":checked") === checked)!;
    expect(cmp(specificity(pick(ours)), specificity(pick(kitHeld)))).toBeGreaterThan(0);
  });
});

// Theia's tab participant writes the current tab (and, with
// highlightModifiedTabs, a dirty tab's top border) in a <style> of its own
// whose order against spexr.css is not fixed: the tile tab wins on weight.
describe("the editor tab's tile", () => {
  /** The CSS the participants add (their addRule templates, interpolations blanked). */
  const participant = [
    ...readFileSync(resolve("@theia/core/lib/browser/common-styling-participants.js"), "utf8").matchAll(/addRule\(`([\s\S]*?)`\)/g),
  ]
    .map((m) => {
      let text = m[1]!;
      while (/\$\{[^{}]*\}/.test(text)) text = text.replace(/\$\{[^{}]*\}/g, "X");
      return text;
    })
    .join("\n");
  const theirs = (part: string): string[] =>
    selectors(participant, (s) => s.includes("#theia-main-content-panel") && s.includes(part) && !s.includes(":hover"));
  const NOT_HC = ':root:not([data-sl-theme="high-contrast"])';

  it("outranks Theia's current-tab rules", () => {
    const current = theirs(".lm-mod-current").filter((s) => !s.includes("theia-mod-dirty"));
    expect(current.length).toBeGreaterThanOrEqual(2);
    const mine = specificity(`${NOT_HC} :is(#theia-main-content-panel, #theia-bottom-content-panel) .lm-TabBar .lm-TabBar-tab.lm-mod-current`);
    for (const s of current) expect(cmp(mine, specificity(s)), s).toBeGreaterThan(0);
  });

  it("outranks Theia's modified-tab borders", () => {
    const dirty = theirs(".theia-mod-dirty");
    expect(dirty.length).toBeGreaterThanOrEqual(2);
    const mine = specificity(`${NOT_HC} body.theia-editor-highlightModifiedTabs #theia-main-content-panel .lm-TabBar .lm-TabBar-tab.theia-mod-dirty.theia-mod-dirty`);
    for (const s of dirty) expect(cmp(mine, specificity(s)), s).toBeGreaterThan(0);
  });

  it("is a 28px tile whose margins fill Theia's 35px strip exactly", () => {
    const tabs = readFileSync(resolve("@theia/core/src/browser/style/tabs.css"), "utf8");
    const strip = Number(/--theia-private-horizontal-tab-height:\s*(\d+)px/.exec(tabs)![1]);
    const start = spexr.indexOf(`\n${NOT_HC} :is(#theia-main-content-panel, #theia-bottom-content-panel) .lm-TabBar .lm-TabBar-tab {`);
    const tab = spexr.slice(start, spexr.indexOf("}", start));
    const height = Number(/\bheight:\s*(\d+)px/.exec(tab)![1]);
    expect(tab).toMatch(/margin-top:\s*round\(down, calc\(\(var\(--theia-horizontal-toolbar-height\) - 28px\) \/ 2\), 1px\)/);
    expect(tab).toMatch(/margin-bottom:\s*round\(up, calc\(\(var\(--theia-horizontal-toolbar-height\) - 28px\) \/ 2\), 1px\)/);
    expect(height).toBe(28);
    expect(height + Math.floor((strip - height) / 2) + Math.ceil((strip - height) / 2)).toBe(strip);
  });
});

// Theia paints the shell's areas from id rules, and the kit's pane is one
// class: the island rules must outrank both, whatever order the sheets load in.
describe("the islands", () => {
  const theia = (file: string): string => readFileSync(resolve(`@theia/core/src/browser/style/${file}`), "utf8");
  const workbench = readFileSync(resolve("@sondalab/ui-kit/workbench.css"), "utf8");
  const NOT_HC = ':root:not([data-sl-theme="high-contrast"])';
  const exactly = (css: string, selector: string): string[] => selectors(css, (s) => s === selector);

  it.each([
    ["sidepanel.css", "#theia-left-content-panel > .lm-Panel", "#theia-app-shell.spexr-islands :is(#theia-left-content-panel, #theia-right-content-panel) > .lm-Panel"],
    ["sidepanel.css", "#theia-bottom-content-panel .lm-TabBar", "#theia-bottom-content-panel.spexr-island .lm-TabBar"],
    ["sidepanel.css", "#theia-bottom-content-panel:not(:has(.lm-TabBar))", "#theia-bottom-content-panel.spexr-island.sl-pane"],
    ["status-bar.css", "#theia-statusBar", "#theia-app-shell.spexr-islands > #theia-statusBar"],
    ["index.css", ".theia-maximized", ".spexr-island.theia-maximized"],
    ["index.css", ".theia-ApplicationShell", "#theia-app-shell.spexr-islands"],
    ["dockpanel.css", ".lm-DockPanel.lm-SplitPanel-child", ".spexr-island.sl-pane.lm-Widget"],
  ])("outrank %s's %s", (file, theirs, ours) => {
    expect(exactly(theia(file), theirs), theirs).toHaveLength(1);
    expect(exactly(spexr, ours), ours).toHaveLength(1);
    expect(cmp(specificity(ours), specificity(theirs))).toBeGreaterThan(0);
  });

  it("narrow the sash over Lumino's and Theia's handle hover paint", () => {
    const lumino = readFileSync(resolve("@lumino/widgets/style/splitpanel.css"), "utf8");
    const view = theia("view-container.css");
    for (const [orientation, ours] of [
      ["horizontal", "#theia-app-shell.spexr-islands > #theia-left-right-split-panel > .lm-SplitPanel-handle::after"],
      ["vertical", "#theia-app-shell.spexr-islands #theia-bottom-split-panel > .lm-SplitPanel-handle::after"],
    ] as const) {
      const theirs = [
        ...selectors(lumino, (s) => s.includes(`'${orientation}'`) && /handle:{1,2}after$/.test(s)),
        ...selectors(view, (s) => s.includes(`"${orientation}"`) && /handle:{1,2}after$/.test(s)),
      ];
      expect(theirs.length, orientation).toBeGreaterThanOrEqual(2);
      expect(exactly(spexr, ours), ours).toHaveLength(1);
      for (const s of theirs) expect(cmp(specificity(ours), specificity(s)), s).toBeGreaterThan(0);
    }
  });

  it.each([
    [".sl-pane[data-lit]", ".spexr-island.sl-pane[data-lit]"],
    [".sl-pane[data-lit]::before", ".spexr-island.sl-pane[data-lit]::before"],
  ])("outrank the kit's %s", (theirs, ours) => {
    // Once at rest and once again under forced colours.
    expect(exactly(workbench, theirs).length, theirs).toBeGreaterThanOrEqual(1);
    expect(exactly(spexr, ours), ours).toHaveLength(1);
    expect(cmp(specificity(ours), specificity(theirs))).toBeGreaterThan(0);
  });

  it("draw the activity bars over Theia's side tab rules", () => {
    const side = selectors(theia("sidepanel.css"), (s) => s.startsWith(".lm-TabBar.theia-app-") && s.includes(".lm-TabBar-tab"));
    expect(side.length).toBeGreaterThanOrEqual(4);
    const tab = specificity(`${NOT_HC} .lm-TabBar.theia-app-sides .lm-TabBar-tab`);
    const icon = specificity(`${NOT_HC} .lm-TabBar.theia-app-sides .lm-TabBar-tabIcon:not(.codicon)`);
    for (const s of side) {
      const mine = s.includes("tabIcon") ? icon : tab;
      expect(cmp(mine, specificity(s)), s).toBeGreaterThan(0);
    }
  });
});

// Theia's status-bar.css sets the same properties on the same elements as the
// status dock (spexr.css): the gap, the face, the size and an item's left
// margin. The dock wins on weight, whatever order the sheets load in.
describe("the status dock", () => {
  const bar = readFileSync(resolve("@theia/core/src/browser/style/status-bar.css"), "utf8");
  const ITEM = "#theia-statusBar .area:is(.left, .right) > .element";

  it.each([
    ["#theia-statusBar .area", "#theia-statusBar .area:is(.left, .right)"],
    ["#theia-statusBar .element", ITEM],
    ["#theia-statusBar .area .element", ITEM],
    ["#theia-statusBar .area.left .element.compact-right", `${ITEM} + .element.compact-right`],
    [
      "#theia-statusBar .area.left .element.has-background:not(#session-preference-status)",
      "#theia-statusBar.lm-Widget .area:is(.left, .right) > .element.has-background:not(#session-preference-status)",
    ],
  ])("outranks %s", (theirs, ours) => {
    expect(selectors(bar, (s) => s === theirs), theirs).toHaveLength(1);
    expect(selectors(spexr, (s) => s === ours).length, ours).toBeGreaterThanOrEqual(1);
    expect(cmp(specificity(ours), specificity(theirs))).toBeGreaterThan(0);
  });
});

// Theia's notifications.css, and its participant's grey container and hover,
// set the same properties as spexr.css's toasts: spexr wins on weight.
describe("the toasts", () => {
  const sheet = readFileSync(resolve("@theia/messages/src/browser/style/notifications.css"), "utf8");
  const participant = [...readFileSync(resolve("@theia/messages/lib/browser/notifications-contribution.js"), "utf8").matchAll(/addRule\(`([\s\S]*?)`\)/g)]
    .map((m) => m[1]!.replace(/\$\{[^{}]*\}/g, "X"))
    .join("\n");
  const NOT_HC = ':root:not([data-sl-theme="high-contrast"])';

  it.each([
    [".theia-notifications-container.theia-notification-toasts .theia-notification-list-item", `${NOT_HC} .theia-notification-toasts .theia-notification-list-item`],
    [".theia-notifications-container.theia-notification-toasts .theia-notification-list-item-container", `${NOT_HC} .theia-notification-toasts .theia-notification-list-item-container`],
    [".theia-notifications-container.theia-notification-center", `${NOT_HC} .theia-notifications-container.theia-notification-center`],
    [".theia-notification-center .theia-notification-list-item:not(:last-child)", `${NOT_HC} .theia-notification-center .theia-notification-list-item`],
    [".theia-notification-icon:before", `${NOT_HC} .theia-notification-icon::before`],
    [".theia-notification-actions > li", `${NOT_HC} .theia-notification-actions > li`],
  ])("outranks %s", (theirs, ours) => {
    expect(selectors(sheet, (s) => s === theirs).length, theirs).toBeGreaterThanOrEqual(1);
    // The toast's own rule, and its @starting-style.
    expect(selectors(spexr, (s) => s === ours).length, ours).toBeGreaterThanOrEqual(1);
    expect(cmp(specificity(ours), specificity(theirs))).toBeGreaterThan(0);
  });

  it("outranks the participant's grey container and its hover", () => {
    const theirs = selectors(participant, (s) => s.startsWith(".theia-notification-list-item"));
    expect(theirs).toEqual(expect.arrayContaining([".theia-notification-list-item-container", ".theia-notification-list-item:hover:not(:focus)"]));
    const container = specificity(`${NOT_HC} .theia-notification-list-item-container`);
    const toast = specificity(`${NOT_HC} .theia-notification-toasts .theia-notification-list-item`);
    const row = specificity(`${NOT_HC} .theia-notification-center .theia-notification-list-item:hover`);
    expect(cmp(container, specificity(".theia-notification-list-item-container"))).toBeGreaterThan(0);
    for (const mine of [toast, row]) expect(cmp(mine, specificity(".theia-notification-list-item:hover:not(:focus)"))).toBeGreaterThan(0);
  });
});

// The bottom island's tile tabs (spexr.css) set what sidepanel.css sets on
// the same tabs and labels: spexr wins on weight.
describe("the bottom island's tile tabs", () => {
  const side = readFileSync(resolve("@theia/core/src/browser/style/sidepanel.css"), "utf8");
  const NOT_HC = ':root:not([data-sl-theme="high-contrast"])';
  const TAB = `${NOT_HC} :is(#theia-main-content-panel, #theia-bottom-content-panel) .lm-TabBar .lm-TabBar-tab`;
  const LABEL = `${NOT_HC} #theia-bottom-content-panel .lm-TabBar .lm-TabBar-tab .theia-tab-icon-label.theia-tab-icon-label`;

  it("outrank every one of Theia's bottom tab and label rules", () => {
    const theirs = selectors(side, (s) => s.startsWith("#theia-bottom-content-panel") && s.includes(".lm-TabBar-tab"));
    expect(theirs.length).toBeGreaterThanOrEqual(5);
    for (const s of theirs) {
      const mine = s.includes(".theia-tab-icon-label")
        ? LABEL
        : s.includes(".lm-mod-current")
          ? `${TAB}.lm-mod-current`
          : TAB;
      expect(selectors(spexr, (x) => x === mine).length, mine).toBeGreaterThanOrEqual(1);
      expect(cmp(specificity(mine), specificity(s)), `${mine} vs ${s}`).toBeGreaterThan(0);
    }
  });
});

// Theia's own focus rule (core index.css) draws a 1px ring inset on every
// focus, a mouse click included, at (0,1,1): it outranked spexr's bare
// *:focus-visible. spexr's pair must outrank it, and stay behind the kit's
// controls, which draw their own flush ring and halo.
describe("the global focus ring", () => {
  const core = readFileSync(resolve("@theia/core/src/browser/style/index.css"), "utf8");
  const ring = "html :focus-visible:not(iframe)";
  const mouse = "html :focus:where(:not(:focus-visible)):not(iframe)";

  it("outranks Theia's focus rule, on a keyboard and on a mouse focus", () => {
    const theirs = selectors(core, (s) => s === ":focus:not(iframe)");
    expect(theirs).toHaveLength(1);
    for (const ours of [ring, mouse]) {
      expect(selectors(spexr, (s) => s === ours), ours).toHaveLength(1);
      expect(cmp(specificity(ours), specificity(theirs[0]!)), ours).toBeGreaterThan(0);
    }
  });

  it("stays behind every kit control's own focus rule", () => {
    const kitRings = selectors(kit, (s) => /^\.sl-[\w-]+:focus-visible$/.test(s));
    expect(kitRings.length).toBeGreaterThanOrEqual(10);
    for (const s of kitRings) expect(cmp(specificity(s), specificity(ring)), s).toBeGreaterThan(0);
  });
});

// A chord's separator carries both separator classes, so the key gap rule
// matches the cap after it too: the chord's 6px must outweigh the key's 3px.
describe("a menu shortcut's chord gap", () => {
  const key = ".lm-Menu-itemShortcut > .sl-kbd + .spexr-key-sep + .sl-kbd";
  const chord = ".lm-Menu-itemShortcut > .sl-kbd + .spexr-key-sep.spexr-key-sep--chord + .sl-kbd";

  it("outweighs the key gap it also matches", () => {
    expect(selectors(spexr, (s) => s === key)).toHaveLength(1);
    expect(selectors(spexr, (s) => s === chord)).toHaveLength(1);
    expect(cmp(specificity(chord), specificity(key))).toBeGreaterThan(0);
  });
});

// Every focus rule of Theia's or Monaco's that outranks the global ring and
// sets its width or its offset but not both must take both from one of
// spexr's rule sets, at a weight above its own (!important where it is):
// otherwise the ring's width and offset come from two rule sets, and it
// floats off the edge with a gap. The installed stylesheets are scanned, so a
// Theia or Monaco update that adds one fails here.
describe("the ring's width and offset", () => {
  const theiaDir = join(dirname(resolve("@theia/core/package.json")), "..");
  const cssFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : cssFiles(path);
      return entry.name.endsWith(".css") ? [path] : [];
    });
  const sheets = [
    ...readdirSync(theiaDir)
      .filter((pkg) => pkg !== "monaco-editor-core")
      .flatMap((pkg) => {
        try {
          return cssFiles(join(theiaDir, pkg, "src"));
        } catch {
          return [];
        }
      }),
    ...cssFiles(join(theiaDir, "monaco-editor-core", "esm")),
  ];
  const norm = (s: string): string => s.replace(/\s+/g, " ").replace(/\s*>\s*/g, " > ").trim();
  type Block = { selectors: string[]; body: string };
  const blocks = (css: string): Block[] =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: splitList(norm(m[1]!)), body: m[2]! }));
  const ring = specificity("html :focus-visible:not(iframe)");

  const partials = sheets.flatMap((file) =>
    blocks(readFileSync(file, "utf8")).flatMap(({ selectors: list, body }) => {
      const outline = /(?:^|;)\s*outline\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
      // A rule that draws no ring at all is wholly its own.
      const none = (outline !== undefined && /^(none|0)\b/.test(outline)) || /outline-width\s*:\s*0\b/.test(body) || /outline-style\s*:\s*none\b/.test(body);
      const width = /outline-width\s*:/.test(body) || (outline !== undefined && !none);
      const offset = /outline-offset\s*:/.test(body);
      if (none || width === offset) return [];
      const important = /outline(-width|-offset)?\s*:[^;]*!important/.test(body);
      return list
        .filter((s) => /:focus(?![-\w])|:focus-visible/.test(s.split(/\s|>|\+|~/).pop()!))
        .filter((s) => important || cmp(specificity(s), ring) > 0)
        .map((s) => ({ selector: s, important }));
    }),
  );

  const fixes = blocks(spexr)
    .filter(({ body }) => /outline-width\s*:\s*var\(--sl-focus-ring-width\)/.test(body) && /outline-offset\s*:\s*calc\(-1 \* var\(--sl-focus-ring-width\)\)/.test(body))
    .flatMap(({ selectors: list, body }) =>
      list.map((s) => ({
        selector: s,
        members: /^:root :is\((.*)\)$/.exec(s) ? splitList(/^:root :is\((.*)\)$/.exec(s)![1]!).map(norm) : [],
        // Both halves, or a Monaco !important on one of them still wins it.
        important: /outline-width\s*:[^;]*!important/.test(body) && /outline-offset\s*:[^;]*!important/.test(body),
      })),
    );

  it("finds the partial rules it guards against", () => {
    expect(partials.map((p) => p.selector)).toEqual(
      expect.arrayContaining([
        '.theia-settings-container .theia-input[type="checkbox"]:focus',
        '.theia-settings-container .theia-input[type="number"]:focus',
        ".monaco-text-button:focus",
        ".monaco-button-dropdown > .monaco-button:focus",
        ".theia-scm-input-message-container textarea:focus",
        ".window-zoom-button:focus-visible",
        ".monaco-editor .review-widget .body .comment-form .review-thread-reply-button:focus",
      ]),
    );
  });

  it("takes both the width and the offset of every one of them from one spexr rule set, above its weight", () => {
    for (const partial of partials) {
      const fix = fixes.find((f) => f.members.includes(partial.selector));
      expect(fix, partial.selector).toBeDefined();
      expect(cmp(specificity(fix!.selector), specificity(partial.selector)), partial.selector).toBeGreaterThan(0);
      expect(fix!.important, partial.selector).toBe(partial.important);
    }
  });

  // Theia's custom select draws its resting border as an outline; a mouse
  // focus must not take it away.
  it("keeps the custom select's resting outline on a mouse focus", () => {
    const theirs = blocks(readFileSync(resolve("@theia/core/src/browser/style/select-component.css"), "utf8")).find((b) => b.selectors.includes(".theia-select-component"))!;
    const mine = blocks(spexr).find((b) => b.selectors.includes("html .theia-select-component:focus:where(:not(:focus-visible))"));
    expect(mine).toBeDefined();
    expect(/outline:\s*([^;]+);/.exec(mine!.body)![1]!.trim()).toBe(/outline:\s*([^;]+);/.exec(theirs.body)![1]!.trim());
    expect(/outline-offset:\s*([^;]+);/.exec(mine!.body)![1]!.trim()).toBe(/outline-offset:\s*([^;]+);/.exec(theirs.body)![1]!.trim());
    expect(cmp(specificity("html .theia-select-component:focus:where(:not(:focus-visible))"), specificity("html :focus:where(:not(:focus-visible)):not(iframe)"))).toBeGreaterThan(0);
  });
});
