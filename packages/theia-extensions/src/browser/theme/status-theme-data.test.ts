import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ColorRegistry } from "@theia/core/lib/browser/color-registry";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { SpexrColorContribution } from "./spexr-color-contribution.js";
import { SPEXR_EDITOR_THEMES, STATUS_GROUND_COLORS, withoutStatusGrounds } from "./status-theme-data.js";

const resolve = createRequire(import.meta.url).resolve;
const themesDir = dirname(resolve("@theia/monaco/data/monaco-themes/vscode/light_theia.json"));
const kitFile = (name: string): string => readFileSync(join(dirname(resolve("@sondalab/ui-kit/effects.js")), name), "utf8");
const source = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

type Theme = "light" | "dark";

/** A built-in theme's colours, its includes first, as MonacoThemeRegistry.register merges them. */
function themeColors(file: string): Record<string, string> {
  const json = JSON.parse(readFileSync(join(themesDir, file), "utf8")) as { include?: string; colors?: Record<string, string> };
  return { ...(json.include ? themeColors(json.include.replace(/^\.\//, "")) : {}), ...(json.colors ?? {}) };
}

/** What spexr registers: id -> its default per theme. */
function registered(): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const registry = { register: (...defs: Array<{ id: string; defaults?: Record<string, string> }>) => defs.forEach((d) => out.set(d.id, d.defaults ?? {})) };
  new SpexrColorContribution().registerColors(registry as unknown as ColorRegistry);
  return out;
}

const raw: Record<Theme, Record<string, string>> = { light: themeColors("light_theia.json"), dark: themeColors("dark_theia.json") };
const defaults = registered();

/** The colour a status item resolves on a theme: the theme's data (as spexr leaves it) first, then the registry. */
const effective = (theme: Theme, id: string): string | undefined => withoutStatusGrounds(raw[theme])[id] ?? defaults.get(id)?.[theme];

const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (c: number[]): number => {
  const f = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
};
const contrast = (a: string, b: string): number => {
  const [x, y] = [lum(hex(a)), lum(hex(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const kitTone = (theme: Theme, name: string): string => new RegExp(`--sl-status-${name}:\\s*(#[0-9a-f]{6})`).exec(kitFile(`themes/${theme}.css`))![1]!;

// Theme data outranks a registry default (Monaco's standalone theme reads its
// own colours first): Theia's built-in light theme paints a plugin's error
// item #c72e0f, and both themes its remote item green, whatever spexr
// registers. Measured from those: the light error pill was 4.44:1 against the
// canvas and its label 5.49.
describe("Theia's built-in theme data", () => {
  it("sets the light error ground and both remote grounds", () => {
    expect(raw.light["statusBarItem.errorBackground"]).toBe("#c72e0f");
    expect(raw.light["statusBarItem.remoteBackground"]).toBe("#16825D");
    expect(raw.dark["statusBarItem.remoteBackground"]).toBe("#16825D");
  });

  it("is the data behind spexr's light and dark (core theming.ts editorTheme)", () => {
    const theming = readFileSync(resolve("@theia/core/src/browser/theming.ts"), "utf8");
    for (const name of SPEXR_EDITOR_THEMES) expect(theming, name).toContain(`editorTheme: '${name}'`);
  });
});

describe("withoutStatusGrounds", () => {
  it("drops exactly the status grounds, and leaves the theme's data untouched", () => {
    const before = { ...raw.light };
    const after = withoutStatusGrounds(raw.light);
    for (const id of STATUS_GROUND_COLORS) expect(after[id], id).toBeUndefined();
    expect(after["editor.background"]).toBe(raw.light["editor.background"]);
    expect(Object.keys(after).length).toBe(Object.keys(raw.light).filter((id) => !(STATUS_GROUND_COLORS as readonly string[]).includes(id)).length);
    expect(raw.light).toEqual(before);
  });

  it("covers every status ground spexr registers, and nothing it does not", () => {
    const grounds = [...defaults.keys()].filter((id) => /^statusBarItem\.\w+(Background|Foreground)$/.test(id));
    expect([...grounds].sort()).toEqual([...STATUS_GROUND_COLORS].sort());
  });
});

// The effective colours, as a plugin's item resolves them once spexr has taken
// the grounds out of the theme data: the kit's tones, read from the kit's own
// theme files, not from spexr's constants.
describe.each(["light", "dark"] as const)("a plugin's status ground on %s", (theme) => {
  const canvas = kitNeutrals.products.spexr[theme]["bg-canvas"];
  const muted = kitNeutrals.products.spexr[theme]["text-muted"];

  it("is the kit's danger and warning, and the muted ink for prominent and remote", () => {
    expect(effective(theme, "statusBarItem.errorBackground")).toBe(kitTone(theme, "danger"));
    expect(effective(theme, "statusBarItem.warningBackground")).toBe(kitTone(theme, "warning"));
    expect(effective(theme, "statusBarItem.prominentBackground")).toBe(muted);
    expect(effective(theme, "statusBarItem.remoteBackground")).toBe(muted);
  });

  it.each(["error", "warning", "prominent", "remote"])("bounds a %s item at 3:1 on the canvas and labels it at 4.5:1", (item) => {
    const fill = effective(theme, `statusBarItem.${item}Background`)!;
    const label = effective(theme, `statusBarItem.${item}Foreground`)!;
    expect(contrast(fill, canvas)).toBeGreaterThanOrEqual(3);
    expect(contrast(label, fill)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the theme data contribution", () => {
  it("gives Theia the light and dark themes again without the grounds, at initialize", () => {
    const contribution = source("./status-theme-data-contribution.ts");
    expect(contribution).toMatch(/initialize\(\): void \{[\s\S]*for \(const name of SPEXR_EDITOR_THEMES\)[\s\S]*this\.themes\.setTheme\(name, \{ \.\.\.data, colors: withoutStatusGrounds\(data\.colors\) \}\)/);
  });

  it("is bound as a frontend contribution", () => {
    expect(source("../spexr-frontend-module.ts")).toContain("bind(FrontendApplicationContribution).to(SpexrStatusThemeDataContribution).inSingletonScope();");
  });
});
