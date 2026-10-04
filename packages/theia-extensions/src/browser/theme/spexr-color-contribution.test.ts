import { describe, expect, it } from "vitest";
import type { ColorRegistry } from "@theia/core/lib/browser/color-registry";
import { SpexrColorContribution } from "./spexr-color-contribution.js";
import { ACCENT_FILL, mixBlack } from "./spexr-accent.js";
import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";

type Defaults = Record<string, string | undefined>;

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

  it("registers the labelled fills on the registered fill and its derived hover", () => {
    expect(colors.get("button.background")).toEqual(both(ACCENT_FILL));
    expect(colors.get("button.hoverBackground")).toEqual(both(mixBlack(ACCENT_FILL, 0.89)));
    expect(colors.get("badge.background")).toEqual(both(ACCENT_FILL));
    expect(colors.get("button.foreground")).toEqual(both("#ffffff"));
    expect(colors.get("badge.foreground")).toEqual(both("#ffffff"));
  });

  it("registers the status bar on the canvas with the muted ink", () => {
    for (const id of ["statusBar.background", "statusBar.noFolderBackground"]) {
      expect(colors.get(id), id).toEqual({ dark: SPEXR_NEUTRALS.dark.canvas, light: SPEXR_NEUTRALS.light.canvas });
    }
    expect(colors.get("statusBar.foreground")).toEqual({ dark: SPEXR_NEUTRALS.dark.fgMuted, light: SPEXR_NEUTRALS.light.fgMuted });
  });

  it("leaves the list selection and the main area's tab border to the CSS layer", () => {
    expect([...colors.keys()].filter((id) => id.startsWith("list.") || id.startsWith("quickInputList."))).toEqual([]);
    expect(colors.has("tab.activeBorderTop")).toBe(false);
  });
});
