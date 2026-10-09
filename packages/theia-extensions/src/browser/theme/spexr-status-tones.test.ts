import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { KIT_STATUS_TONES } from "./spexr-accent.js";

const kitDir = dirname(createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.js"));

describe("the kit's status tones in spexr-accent.ts", () => {
  it.each(["light", "dark"] as const)("%s: match --sl-status-* in the installed kit's theme file", (theme) => {
    const css = readFileSync(join(kitDir, `themes/${theme}.css`), "utf8");
    expect(css.length).toBeGreaterThan(100);
    for (const [name, hex] of Object.entries(KIT_STATUS_TONES[theme])) {
      const found = new RegExp(`--sl-status-${name}:\\s*(#[0-9a-f]{6})`).exec(css);
      expect(found, `${theme} ${name} declared`).not.toBeNull();
      expect(hex).toBe(found![1]);
    }
  });

  it("are what --slc-<tone>-text falls back to: the kit's stylesheets define the -text roles only inside a band", () => {
    const components = readFileSync(join(kitDir, "components.css"), "utf8");
    // the -text role is a relative colour of the tone, defined in a rule scoped to a band, not at :root
    expect(components).toMatch(/--slc-danger-text:\s+oklch\(from var\(--slc-danger\)/);
    const rule = /([^{}]*)\{[^{}]*--slc-danger-text:/.exec(components);
    expect(rule, "the rule that defines --slc-danger-text").not.toBeNull();
    expect(rule![1]).not.toMatch(/^\s*:root\s*$/);
  });
});
