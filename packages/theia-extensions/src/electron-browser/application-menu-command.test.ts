import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OPEN_APPLICATION_MENU_COMMAND, OPEN_APPLICATION_MENU_KEYS } from "./application-menu-command.js";

const resolve = createRequire(import.meta.url).resolve;
const own = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

/** A chord in one spelling: modifiers sorted, ctrlcmd as ctrl. */
function normal(chord: string): string {
  const parts = chord.toLowerCase().replace(/ctrlcmd/g, "ctrl").split("+");
  const key = parts.pop()!;
  return [...parts.sort(), key].join("+");
}

/** Every `.js`/`.ts` file under a directory, skipping maps, declarations and tests. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(js|tsx?)$/.test(name) && !/\.d\.ts$|\.test\./.test(name) ? [path] : [];
  });
}

/**
 * The first chord of every string keybinding in a source text. It sees a
 * literal `keybinding: "..."`, or the non-macOS side of one `isOSX ? a : b`;
 * a binding built any other way (a nested ternary, a variable, a computed
 * string) is not seen.
 */
function bindings(text: string): string[] {
  return [...text.matchAll(/keybinding['"]?\s*:\s*(?:isOSX\s*\?\s*['"][^'"]*['"]\s*:\s*)?['"]([^'"]+)['"]/g)].map((m) => normal(m[1]!.split(" ")[0]!));
}

describe("the application menu command", () => {
  it("is spexr's, in the View category", () => {
    expect(OPEN_APPLICATION_MENU_COMMAND.id).toBe("spexr.titlebar.openMenu");
    expect(OPEN_APPLICATION_MENU_COMMAND.category).toBe("View");
  });

  // F10 is Debug: Step Over (@theia/debug), which is how this test found it.
  it("takes a chord no Theia package, no Monaco binding and no other spexr binding uses", () => {
    const chord = normal(OPEN_APPLICATION_MENU_KEYS);
    expect(chord).toBe("alt+shift+m");
    const theiaRoot = dirname(dirname(resolve("@theia/core/package.json")));
    const taken = new Map<string, string>();
    for (const pkg of readdirSync(theiaRoot)) {
      let lib: string;
      try {
        lib = join(dirname(resolve(`@theia/${pkg}/package.json`)), "lib");
        if (!statSync(lib).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const file of sources(lib)) for (const b of bindings(readFileSync(file, "utf8"))) taken.set(b, file);
    }
    expect(taken.get("f10"), "the scan sees Theia's bindings").toMatch(/@theia[\\/]debug/);
    expect(taken.has(chord), taken.get(chord)).toBe(false);

    const spexr = fileURLToPath(new URL("..", import.meta.url));
    const ours = sources(spexr).filter((f) => !f.endsWith("application-menu-command.ts"));
    for (const file of ours) expect(bindings(readFileSync(file, "utf8")), file).not.toContain(chord);

    // Monaco binds by key code: Alt is 512, Shift 1024, M 43.
    const monaco = join(dirname(resolve("@theia/monaco-editor-core/package.json")), "esm", "vs");
    const altShiftM = /512 \/\* KeyMod\.Alt \*\/ \| 1024 \/\* KeyMod\.Shift \*\/ \| 43 \/\* KeyCode\.KeyM \*\/|1024 \/\* KeyMod\.Shift \*\/ \| 512 \/\* KeyMod\.Alt \*\/ \| 43 \/\* KeyCode\.KeyM \*\//;
    expect(sources(monaco).some((f) => altShiftM.test(readFileSync(f, "utf8")))).toBe(false);
  });

  it("is registered with its keys off macOS only, and runs the bar's menu button", () => {
    const contribution = own("./spexr-electron-menu-contribution.ts");
    expect(contribution).toContain("registry.registerCommand(OPEN_APPLICATION_MENU_COMMAND, {");
    expect(contribution).toContain("execute: () => this.titleBar.openApplicationMenu(),");
    expect(contribution).toContain("isEnabled: () => this.titleBar.hasMenuButton(),");
    expect(contribution).toContain("if (!isOSX) registry.registerKeybinding({ command: OPEN_APPLICATION_MENU_COMMAND.id, keybinding: OPEN_APPLICATION_MENU_KEYS });");
    expect(contribution).toMatch(/override registerCommands\(registry: CommandRegistry\): void \{\s*super\.registerCommands\(registry\);/);
    expect(contribution).toMatch(/override registerKeybindings\(registry: KeybindingRegistry\): void \{\s*super\.registerKeybindings\(registry\);/);
  });
});
