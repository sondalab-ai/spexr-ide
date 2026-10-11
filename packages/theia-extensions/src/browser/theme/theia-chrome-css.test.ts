import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { theiaChromeCss } from "./theia-chrome-css.js";
import { ACCENT, ACCENT_FILL, fillStep, labelOn } from "./spexr-accent.js";
import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";

/** The value theiaChromeCss gives a `--theia-*` variable, or undefined. */
function value(theme: string, name: string): string | undefined {
  return new RegExp(`--theia-${name}:\\s*([^;]+?)\\s*!important;`).exec(theiaChromeCss(theme))?.[1];
}

// Selection was the #5b6cff accent with a white label (4.17:1 on light); it is
// the kit's tile under the primary ink (kit 0.31), in light and dark.
describe("Theia's selection", () => {
  it.each(["light", "dark"])("is the tile under the primary ink on %s", (theme) => {
    for (const name of ["list-activeSelectionBackground", "list-inactiveSelectionBackground", "quickInputList-focusBackground"]) {
      expect(value(theme, name), name).toBe("var(--slc-tile)");
    }
    for (const name of ["list-activeSelectionForeground", "list-inactiveSelectionForeground", "quickInputList-focusForeground"]) {
      expect(value(theme, name), name).toBe("var(--slc-text)");
    }
    expect(value(theme, "list-highlightForeground")).toBe("var(--slc-accent-text)");
  });
});

// The accent as text was #5b6cff on light: 3.37:1 on the canvas, 4.03 on the
// surface. The kit's accent-as-text role caps it there (and is the accent on dark).
describe("Theia's accent as text", () => {
  it.each(["light", "dark"])("is the kit's accent-text role on %s", (theme) => {
    for (const name of [
      "button-secondaryForeground",
      "textLink-foreground",
      "editorLink-activeForeground",
      "inputOption-activeForeground",
      "gitDecoration-addedResourceForeground",
      "pickerGroup-foreground",
    ]) {
      expect(value(theme, name), name).toBe("var(--slc-accent-text)");
    }
  });

  it("steps a hovered link one shade further from its ground", () => {
    const step = "var(--slc-shade-step, 0.075)";
    expect(value("light", "textLink-activeForeground")).toBe(`oklch(from var(--slc-accent-text) calc(l - ${step}) calc(c * max(0, 1 - ${step} / max(l, 0.001))) h)`);
    expect(value("dark", "textLink-activeForeground")).toBe(`oklch(from var(--slc-accent-text) calc(l + ${step}) calc(c * pow(max(0, 1 - ${step} / max(1 - l, 0.001)), 1.5)) h)`);
  });
});

/** A file of the installed @sondalab/ui-kit. */
const kitFile = (name: string): string => readFileSync(createRequire(import.meta.url).resolve(`@sondalab/ui-kit/${name}`), "utf8");

/** Every stylesheet spexr ships: its ui-kit package's and the Theia extension's. */
function spexrStylesheets(dir = fileURLToPath(new URL("../../../../", import.meta.url))): string[] {
  return ["ui-kit/src", "theia-extensions/src"].flatMap(function walk(rel: string): string[] {
    return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(rel, e.name)) : e.name.endsWith(".css") ? [join(dir, rel, e.name)] : [],
    );
  });
}

// A white label on the #5b6cff accent read 4.17:1; the registered fill reads 5.41.
describe("Theia's labelled fills", () => {
  // Since kit 0.35 the fill is the kit's to set, per theme, from the
  // registry (themes/products.css under data-sl-product="spexr"), so a fill
  // changed in the registry reaches the kit's controls and Theia's chrome
  // alike. A rule of spexr's would win over it (after products.css, at its
  // weight) or lose to it silently (any lighter), so there is none.
  it("are spexr's registered fill, which the kit's products.css sets on each theme", () => {
    const neutrals = JSON.parse(kitFile("neutrals.json"));
    expect(neutrals.products.spexr.fill).toEqual(ACCENT_FILL);
    const products = kitFile("themes/products.css");
    for (const theme of ["light", "dark"] as const) {
      const at = products.indexOf(`[data-sl-product="spexr"][data-sl-theme="${theme}"]`);
      expect(at, `spexr's ${theme} block in products.css`).toBeGreaterThanOrEqual(0);
      expect(products.slice(at, products.indexOf("}", at))).toContain(`--slc-accent-fill: ${ACCENT_FILL[theme]};`);
    }
  });

  it("reach spexr, which loads products.css and marks its theme element as spexr's", () => {
    const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    expect(src("../style/spexr.css")).toContain(`@import "@spexr/ui-kit/themes/products.css";`);
    expect(src("../../../../ui-kit/src/themes/products.css")).toContain(`@import "@sondalab/ui-kit/themes/products.css";`);
    const contribution = src("./spexr-theme-contribution.ts");
    expect(contribution).toContain(`document.documentElement.setAttribute("data-sl-theme", spexrTheme);`);
    expect(contribution).toContain(`document.documentElement.setAttribute("data-sl-product", "spexr");`);
  });

  it("are set by no stylesheet of spexr's", () => {
    const sheets = spexrStylesheets();
    expect(sheets.some((f) => f.endsWith("spexr-overrides.css")), "spexr-overrides.css found").toBe(true);
    for (const file of sheets) expect(readFileSync(file, "utf8"), file).not.toMatch(/--slc-accent-fill\s*:/);
    for (const theme of ["light", "dark", "high-contrast"]) expect(theiaChromeCss(theme)).not.toMatch(/--slc-accent-fill\s*:/);
  });

  it.each(["light", "dark"] as const)("carry the kit's label on the fill on %s", (theme) => {
    for (const name of ["button-background", "badge-background", "activityBarBadge-background", "menu-selectionBackground"]) {
      expect(value(theme, name), name).toBe(ACCENT_FILL[theme]);
    }
    expect(value(theme, "button-hoverBackground")).toBe(fillStep(ACCENT_FILL[theme], "hover"));
    for (const name of ["button-foreground", "badge-foreground", "activityBarBadge-foreground", "menu-selectionForeground"]) {
      expect(value(theme, name), name).toBe(labelOn(ACCENT_FILL[theme]));
    }
  });
});

// The status bar sits on the canvas in the muted ink, not on an accent strip.
// The accent and its wash come from the kit's accent registry, not literals.
describe("Theia's accent", () => {
  it.each(["light", "dark"] as const)("is the registry's accent on %s", (theme) => {
    expect(value(theme, "focusBorder")).toBe(ACCENT[theme]);
    expect(value(theme, "button-secondaryBackground")).toBe(`color-mix(in srgb, ${ACCENT[theme]} ${theme === "dark" ? 12 : 10}%, transparent)`);
  });
});

// The terminal sits on an island's surface, as the registry has it for xterm.
describe("Theia's terminal", () => {
  it.each(["light", "dark"] as const)("is the island surface on %s", (theme) => {
    expect(value(theme, "terminal-background")).toBe(SPEXR_NEUTRALS[theme].surface);
  });
});

describe("Theia's status bar", () => {
  it.each(["light", "dark"] as const)("is the canvas with the muted ink on %s", (theme) => {
    expect(value(theme, "statusBar-background")).toBe(SPEXR_NEUTRALS[theme].canvas);
    expect(value(theme, "statusBar-foreground")).toBe(SPEXR_NEUTRALS[theme].fgMuted);
  });

  // Theia's prominent items (Restricted Mode, Session Preferences) were a 50%
  // black under the muted ink, and the offline bar's label the registry's
  // editor background, which spexr does not set. Each is a kit fill with the
  // kit's label on it now (contrast.test.ts measures them).
  it.each(["light", "dark"] as const)("gives a prominent item the muted ink as a fill, with the kit's label, on %s", (theme) => {
    for (const state of ["", "Hover"]) {
      expect(value(theme, `statusBarItem-prominent${state}Background`), state).toBe("var(--slc-text-muted)");
      expect(value(theme, `statusBarItem-prominent${state}Foreground`), state).toBe("oklch(from var(--slc-text-muted) var(--_sl-on))");
    }
  });

  it.each(["light", "dark"] as const)("turns the offline bar the kit's warning, stepped by the kit's rule, on %s", (theme) => {
    expect(value(theme, "statusBar-offlineBackground")).toBe("var(--slc-warning)");
    expect(value(theme, "statusBar-offlineForeground")).toBe("var(--slc-on-warning)");
    expect(value(theme, "statusBarItem-offlineHoverBackground")).toBe("oklch(from var(--slc-warning) var(--_sl-step-hover))");
    expect(value(theme, "statusBarItem-offlineActiveBackground")).toBe("oklch(from var(--slc-warning) var(--_sl-step-press))");
  });
});

// A notification's glyph (and the language status's) was the editor's error,
// warning and info colours; it is the kit's tone, as the toast's tick is.
describe("Theia's notification glyphs", () => {
  it.each(["light", "dark"] as const)("are the kit's tones on %s", (theme) => {
    expect(value(theme, "notificationsInfoIcon-foreground")).toBe("var(--slc-info-text, var(--slc-info))");
    expect(value(theme, "notificationsWarningIcon-foreground")).toBe("var(--slc-warning-text, var(--slc-warning))");
    expect(value(theme, "notificationsErrorIcon-foreground")).toBe("var(--slc-danger-text, var(--slc-danger))");
  });
});

// The activity bars are the kit's (0.33): muted glyphs on the canvas, the
// hovered and current one in the primary ink.
describe("Theia's activity bars", () => {
  it.each(["light", "dark"] as const)("read the kit's inks on %s", (theme) => {
    expect(value(theme, "activityBar-inactiveForeground")).toBe(SPEXR_NEUTRALS[theme].fgMuted);
    expect(value(theme, "activityBar-foreground")).toBe(SPEXR_NEUTRALS[theme].fg);
  });
});

// Trees take the kit's hairline guides, the selection's path one border step stronger.
describe("Theia's tree guides", () => {
  it.each(["light", "dark"])("are the kit's hairlines on %s", (theme) => {
    expect(value(theme, "tree-inactiveIndentGuidesStroke")).toBe("var(--slc-border-subtle)");
    expect(value(theme, "tree-indentGuidesStroke")).toBe("var(--slc-border)");
  });
});

// The main area's tabs are tile tabs drawn in spexr.css; the colours Theia's
// own tab rules read there are no longer set.
describe("the editor tabs' Theia colours", () => {
  it.each(["light", "dark"])("are not injected on %s", (theme) => {
    for (const name of ["tab-activeBorderTop", "tab-unfocusedActiveBorderTop", "tab-activeBackground", "tab-hoverBackground", "tab-inactiveBackground", "tab-border"]) {
      expect(value(theme, name), name).toBeUndefined();
    }
  });
});

// Errors, warnings and infos in Theia's chrome are the kit's tones as text; the
// registry's reds and blues stay in Monaco's own squiggles and hovers.
describe("Theia's severity colours", () => {
  const roles: Record<string, string> = { Error: "danger", Warning: "warning", Info: "info" };
  it.each(["light", "dark"])("are the kit's danger, warning and info as text on %s", (theme) => {
    for (const [severity, role] of Object.entries(roles)) {
      const expected = `var(--slc-${role}-text, var(--slc-${role}))`;
      expect(value(theme, `editor${severity}-foreground`), severity).toBe(expected);
      expect(value(theme, `problems${severity}Icon-foreground`), severity).toBe(expected);
    }
    expect(value(theme, "list-errorForeground")).toBe("var(--slc-danger-text, var(--slc-danger))");
    expect(value(theme, "list-warningForeground")).toBe("var(--slc-warning-text, var(--slc-warning))");
  });
});

// High contrast keeps Theia's own HC colours and the kit's yellow: the
// injection there is the faces only, no indigo fill, no light accent.
describe("high contrast", () => {
  it("gets the UI and code faces and nothing else", () => {
    const vars = [...theiaChromeCss("high-contrast").matchAll(/--theia-([\w-]+):/g)].map((m) => m[1]);
    expect(vars).toEqual(["ui-font-family", "code-font-family"]);
  });
});

// Theia's code variable was its Menlo/Consolas stack; it is the code face
// (Geist Mono, through --sl-font-code), on every theme, set on body too.
describe("Theia's code font", () => {
  it.each(["light", "dark", "high-contrast"])("is the code face on %s", (theme) => {
    expect(value(theme, "code-font-family")).toBe("var(--sl-font-code)");
  });

  it("is set where the UI face is, on :root and body", () => {
    const block = /:root,\s*body\s*\{([^}]*)\}/.exec(theiaChromeCss("dark"))?.[1] ?? "";
    expect(block).toContain("--theia-code-font-family: var(--sl-font-code) !important;");
  });
});

// Monaco's hovers, suggest details and parameter hints read
// --monaco-monospace-font, which Monaco declares on .monaco-editor ("SF Mono",
// Monaco, Menlo, …); the code face must win there as well as on :root.
describe("Monaco's own code font", () => {
  it.each(["light", "dark", "high-contrast"])("is the code face, inside the editor too, on %s", (theme) => {
    const rule = [...theiaChromeCss(theme).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) =>
      m[2]!.includes("--monaco-monospace-font"),
    );
    expect(rule?.[1]!.split(",").map((s) => s.trim())).toEqual([":root", "body", ".monaco-editor"]);
    expect(rule?.[2]).toContain("--monaco-monospace-font: var(--sl-font-code) !important;");
  });
});

// --sl-font-code was JetBrains Mono first (owner, 2026-10-02); it is the
// kit's mono since the owner reversed that on 2026-10-05.
describe("the code face role", () => {
  it("is the kit's mono", () => {
    const css = readFileSync(
      fileURLToPath(new URL("../../../../ui-kit/src/themes/spexr-overrides.css", import.meta.url)),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(/--sl-font-code:\s*([^;]+);/.exec(css)?.[1]).toBe("var(--sl-font-mono)");
    expect(css).not.toContain("JetBrains");
  });
});
