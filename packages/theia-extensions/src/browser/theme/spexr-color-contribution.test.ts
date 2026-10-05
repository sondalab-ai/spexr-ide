import { describe, expect, it } from "vitest";
import type { ColorRegistry } from "@theia/core/lib/browser/color-registry";
import { SpexrColorContribution } from "./spexr-color-contribution.js";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ACCENT, ACCENT_FILL, accentText, accentTextActive, fillStep, labelOn } from "./spexr-accent.js";
import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";

type Defaults = Record<string, string | undefined>;

const kitDir = dirname(createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.js"));

/** What the contribution registers: id -> defaults, from a registry that only records. */
function registered(): Map<string, Defaults> {
  const calls = new Map<string, Defaults>();
  const registry = {
    register: (...defs: Array<{ id: string; defaults?: Defaults }>) => {
      for (const def of defs) calls.set(def.id, def.defaults ?? {});
    },
  };
  new SpexrColorContribution().registerColors(registry as unknown as ColorRegistry);
  return calls;
}

describe("SpexrColorContribution", () => {
  const colors = registered();
  const both = (value: string): Defaults => ({ dark: value, light: value });

  it("registers the labelled fills on the registered fill and its hover by the kit's step rule", () => {
    expect(colors.get("button.background")).toEqual(ACCENT_FILL);
    expect(colors.get("button.hoverBackground")).toEqual({ dark: fillStep(ACCENT_FILL.dark, "hover"), light: fillStep(ACCENT_FILL.light, "hover") });
    expect(colors.get("badge.background")).toEqual(ACCENT_FILL);
    expect(colors.get("button.foreground")).toEqual(both("#ffffff"));
    expect(colors.get("badge.foreground")).toEqual(both("#ffffff"));
  });

  it("registers the accent as text from the registry, as the kit derives it", () => {
    const text = { dark: accentText("dark"), light: accentText("light") };
    for (const id of ["textLink.foreground", "editorLink.activeForeground", "inputOption.activeForeground", "pickerGroup.foreground"]) {
      expect(colors.get(id), id).toEqual(text);
    }
    expect(colors.get("textLink.activeForeground")).toEqual({ dark: accentTextActive("dark"), light: accentTextActive("light") });
    expect(colors.get("focusBorder")).toEqual(ACCENT);
  });

  it("registers the status bar on the canvas with the muted ink", () => {
    for (const id of ["statusBar.background", "statusBar.noFolderBackground"]) {
      expect(colors.get(id), id).toEqual({ dark: SPEXR_NEUTRALS.dark.canvas, light: SPEXR_NEUTRALS.light.canvas });
    }
    expect(colors.get("statusBar.foreground")).toEqual({ dark: SPEXR_NEUTRALS.dark.fgMuted, light: SPEXR_NEUTRALS.light.fgMuted });
  });

  // A plugin's status item is painted inline with the registry's literal,
  // which the CSS layer never reaches. The tones are read from the installed
  // kit's theme files, not from spexr's own constants.
  it("registers a status item's error and warning grounds in the kit's tones, with the kit's label", () => {
    const tone = (theme: "light" | "dark", name: string): string =>
      new RegExp(`--sl-status-${name}:\\s*(#[0-9a-f]{6})`).exec(readFileSync(join(kitDir, `themes/${theme}.css`), "utf8"))![1]!;
    for (const [item, name] of [["error", "danger"], ["warning", "warning"]] as const) {
      const fill = { dark: tone("dark", name), light: tone("light", name) };
      expect(colors.get(`statusBarItem.${item}Background`), item).toEqual(fill);
      expect(colors.get(`statusBarItem.${item}Foreground`), item).toEqual({ dark: labelOn(fill.dark), light: labelOn(fill.light) });
    }
  });

  // Theia's prominent was a 50% black under the muted ink, its remote a
  // green from the theme data: both are neutral, the muted ink as a fill.
  it("registers the prominent and remote grounds as the muted ink, with the kit's label", () => {
    const muted = { dark: SPEXR_NEUTRALS.dark.fgMuted, light: SPEXR_NEUTRALS.light.fgMuted };
    for (const item of ["prominent", "remote"]) {
      expect(colors.get(`statusBarItem.${item}Background`), item).toEqual(muted);
      expect(colors.get(`statusBarItem.${item}Foreground`), item).toEqual({ dark: labelOn(muted.dark), light: labelOn(muted.light) });
    }
  });

  // xterm and the minimap paint from the registry, never from the CSS layer:
  // on the canvas the terminal read as a hole through its island (1.00:1
  // against the frame), and the minimap kept Theia's #1e1e1e on dark.
  it("registers the terminal and the minimap on the island surface", () => {
    for (const id of ["terminal.background", "minimap.background"]) {
      expect(colors.get(id), id).toEqual({
        dark: SPEXR_NEUTRALS.dark.surface,
        light: SPEXR_NEUTRALS.light.surface,
        hcDark: "editor.background",
        hcLight: "editor.background",
      });
    }
  });

  it("leaves the list selection and the main area's tab border to the CSS layer", () => {
    expect([...colors.keys()].filter((id) => id.startsWith("list.") || id.startsWith("quickInputList."))).toEqual([]);
    expect(colors.has("tab.activeBorderTop")).toBe(false);
  });
});
