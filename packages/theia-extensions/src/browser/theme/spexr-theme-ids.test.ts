import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_THEME_ALIASES, SPEXR_COLOR_THEMES, SPEXR_COLOR_THEME_LABELS, SPEXR_THEME_BY_THEIA, THEIA_THEME_BY_SPEXR } from "./spexr-theme-ids.js";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repo = join(here, "../../../../..");
const read = (path: string): string => readFileSync(path, "utf8");

describe("the spexr colour themes and their aliases", () => {
  it("registers spexr-light and spexr-dark, labelled", () => {
    expect(SPEXR_COLOR_THEMES).toEqual({ light: "spexr-light", dark: "spexr-dark" });
    expect(SPEXR_COLOR_THEME_LABELS).toEqual({ light: "SPEXR Light", dark: "SPEXR Dark" });
  });

  it("resolves the old ids, Theia's light and dark, to the spexr theme of the same kind", () => {
    for (const [legacy, kind] of Object.entries(LEGACY_THEME_ALIASES)) {
      expect(SPEXR_THEME_BY_THEIA[legacy], legacy).toBe(kind);
      expect(THEIA_THEME_BY_SPEXR[SPEXR_THEME_BY_THEIA[legacy]!], legacy).toBe(SPEXR_COLOR_THEMES[kind]);
    }
    expect(Object.keys(LEGACY_THEME_ALIASES).sort()).toEqual(["dark", "light"]);
  });

  it("reads each spexr theme and high contrast back to the data-sl-theme value they carry", () => {
    expect(SPEXR_THEME_BY_THEIA["spexr-dark"]).toBe("dark");
    expect(SPEXR_THEME_BY_THEIA["spexr-light"]).toBe("light");
    expect(SPEXR_THEME_BY_THEIA["hc-theia"]).toBe("high-contrast");
    expect(THEIA_THEME_BY_SPEXR["high-contrast"]).toBe("hc-theia");
    expect(THEIA_THEME_BY_SPEXR["dark"]).toBe("spexr-dark");
    expect(THEIA_THEME_BY_SPEXR["light"]).toBe("spexr-light");
  });

  it("is mirrored by the startup guard's map of a stored Theia theme, which reads localStorage 'theme' before any script runs", () => {
    const html = read(join(repo, "apps/desktop/preload.html"));
    const map = /\(\{([^}]*)\}\)\[localStorage\.getItem\('theme'\)\]/.exec(html);
    expect(map, "the guard's id map").not.toBeNull();
    const entries = Object.fromEntries([...map![1]!.matchAll(/'?([\w-]+)'?:\s*'([\w-]+)'/g)].map((m) => [m[1], m[2]]));
    expect(Object.keys(entries).length).toBeGreaterThan(4);
    for (const [theiaId, spexr] of Object.entries(SPEXR_THEME_BY_THEIA)) expect(entries[theiaId], theiaId).toBe(spexr);
  });

  // The ids spexr leans on are Theia's: a rename would silently leave the old
  // built-in as the only theme, so the installed ones are read.
  it("matches Theia's built-in themes: the aliases and high contrast exist, and nothing of spexr's collides", () => {
    const text = read(require.resolve("@theia/core/lib/browser/theming.js"));
    for (const id of [...Object.keys(LEGACY_THEME_ALIASES), "hc-theia"]) {
      expect(text, id).toMatch(new RegExp(`id: '${id}'`));
    }
    for (const id of Object.values(SPEXR_COLOR_THEMES)) expect(text, id).not.toMatch(new RegExp(`id: '${id}'`));
    // a colour theme names its Monaco theme with editorTheme, and the contribution registers both
    expect(text).toMatch(/editorTheme: 'dark-theia'/);
    expect(text).toMatch(/editorTheme: 'light-theia'/);
    // and ThemeService.register re-validates the active theme, so a theme registered after startup can take over a stored id
    expect(text).toMatch(/register\(\.\.\.themes\)[\s\S]*?this\.validateActiveTheme\(\)/);
  });
});

describe("the Monaco theme registration's guards on Theia and Monaco", () => {
  const monaco = (file: string): string => read(require.resolve(`@theia/monaco/lib/browser/${file}`));

  it("the registry registers a theme by name and base, and the default themes are the ones the spexr themes are built on", () => {
    const text = monaco("textmate/monaco-theme-registry.js");
    expect(text).toMatch(/register\(json, includes, givenName, monacoBase\)/);
    expect(text).toMatch(/getThemeData\(name\)/);
    expect(text).toMatch(/DARK_DEFAULT_THEME = 'dark-theia'/);
    expect(text).toMatch(/LIGHT_DEFAULT_THEME = 'light-theia'/);
    // the default themes are registered by initializeDefaultThemes, which runs before any contribution initializes
    expect(text).toMatch(/initializeDefaultThemes\(\)/);
    // a theme's own token rules come from tokenColors, or from an include: neither is used here
    expect(text).toMatch(/const tokenColors = json\.tokenColors/);
  });

  it("registerParsedTheme persists a theme to IndexedDB, which is why the contribution registers with the registry directly", () => {
    const text = monaco("monaco-theming-service.js");
    expect(text).toMatch(/registerParsedTheme\(theme\)[\s\S]*?doRegisterParsedTheme/);
    expect(text).toMatch(/putTheme\)\(state\)/);
  });

  it("the textmate service takes the current theme's editorTheme as the Monaco theme to set", () => {
    const text = monaco("textmate/monaco-textmate-service.js");
    expect(text).toMatch(/theme\.editorTheme \|\| /);
    expect(text).toMatch(/monaco\.editor\.setTheme\(currentEditorTheme\)/);
  });

  it("the contribution is bound at initialize, after Monaco's default themes exist", () => {
    const contribution = read(join(here, "spexr-monaco-theme-contribution.ts"));
    expect(contribution).toMatch(/initialize\(\): void/);
    expect(contribution).toMatch(/getThemeData\(editorTheme\)/);
    expect(contribution).toMatch(/this\.themeService\.register\(/);
    const module = read(join(here, "../spexr-frontend-module.ts"));
    expect(module).toMatch(/bind\(FrontendApplicationContribution\)\.to\(SpexrMonacoThemeContribution\)/);
  });
});
