import { injectable } from "@theia/core/shared/inversify";
import type { ColorContribution } from "@theia/core/lib/browser/color-application-contribution";
import type { ColorRegistry } from "@theia/core/lib/browser/color-registry";
import { ColorDefaults } from "@theia/core/lib/common/color";
import { terminalAnsiColorMap } from "@theia/terminal/lib/common/terminal-preferences";
import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";
import { terminalColors } from "./spexr-terminal-palette.js";
import { ACCENT, ACCENT_FILL, KIT_STATUS_FILL, accentText, accentTextActive, fillStep, labelOn } from "./spexr-accent.js";

type PerTheme = { dark: string; light: string };

/**
 * The registry colours of a fill that carries a label, per theme: the fill,
 * its hover by the kit's step rule, and the kit's label on it (labelOn: white
 * on spexr's fill today, the dark pole on a light fill). Pure and defaulted
 * to the registered fill, so a test can hand it another fill.
 */
export function labelledFillColors(fill: PerTheme = ACCENT_FILL): { background: PerTheme; hoverBackground: PerTheme; foreground: PerTheme } {
  const each = (f: (hex: string) => string): PerTheme => ({ dark: f(fill.dark), light: f(fill.light) });
  return { background: each((hex) => hex), hoverBackground: each((hex) => fillStep(hex, "hover")), foreground: each(labelOn) };
}

/**
 * One accent-color override. `defaults` map dark/light to the accent (high
 * contrast keeps Theia's own values). These re-register monaco's built-in
 * color ids, whose defaults are the Theia/VS Code blue — registering here
 * replaces the default at the source, so Theia regenerates the matching
 * `--theia-*` CSS variable on every theme change, and Monaco's own widgets
 * (hovers, the quick pick) read them. Every value comes from the kit's accent
 * registry: the accent ("fill", for edges and lines), the accent as text
 * ("text", capped on light like --slc-accent-text; "textActive", one shade
 * step further from its ground for a hovered link) and the registered fill
 * with its hover by the kit's step rule ("labelled", "labelledHover").
 */
function accent(
  colors: ColorRegistry,
  id: string,
  variant: "fill" | "text" | "textActive" | "onAccent" | "labelled" | "labelledHover",
): void {
  const labelled = labelledFillColors();
  const value =
    variant === "onAccent"
      ? labelled.foreground
      : variant === "text"
        ? { dark: accentText("dark"), light: accentText("light") }
        : variant === "textActive"
          ? { dark: accentTextActive("dark"), light: accentTextActive("light") }
          : variant === "labelled"
            ? labelled.background
            : variant === "labelledHover"
              ? labelled.hoverBackground
              : { dark: ACCENT.dark, light: ACCENT.light };
  colors.register({
    id,
    defaults: value,
    description: `SPEXR: violet accent override for ${id}.`,
  });
}

/**
 * Overrides Theia's blue accent with the SPEXR violet, and puts the surfaces
 * that paint into a canvas (xterm, Monaco's minimap) on the island surface.
 *
 * The accent ids re-registered here are monaco *registry defaults* (button,
 * focus ring, badge, links, tabs, input options): replacing them at the
 * registry is race-free and propagates to the native chrome automatically.
 * The two blues baked into the theme JSON (`activityBarBadge.background`,
 * `menu.selectionBackground`) win over registry defaults, so those are
 * handled by the CSS `!important` layer in SpexrThemeContribution.
 */
@injectable()
export class SpexrColorContribution implements ColorContribution {
  registerColors(colors: ColorRegistry): void {
    // Focus ring
    accent(colors, "focusBorder", "fill");

    // Native buttons and badges: the registered fill, with the kit's label on
    // it (white on spexr's fill today; the dark pole on a light fill)
    accent(colors, "button.background", "labelled");
    accent(colors, "button.hoverBackground", "labelledHover");
    accent(colors, "button.foreground", "onAccent");
    accent(colors, "badge.background", "labelled");
    accent(colors, "badge.foreground", "onAccent");

    // Progress bar
    accent(colors, "progressBar.background", "fill");

    // Links: the accent as text (#5b6cff itself read 4.17:1 on a light hover)
    accent(colors, "textLink.foreground", "text");
    accent(colors, "textLink.activeForeground", "textActive");
    accent(colors, "editorLink.activeForeground", "text");

    // Activity bar active highlight
    accent(colors, "activityBar.activeBorder", "fill");
    accent(colors, "activityBar.activeFocusBorder", "fill");

    // Input options (e.g. case-sensitive toggle)
    accent(colors, "inputOption.activeBorder", "fill");
    accent(colors, "inputOption.activeForeground", "text");

    // Quick-pick group label / picker accents
    accent(colors, "pickerGroup.foreground", "text");

    // Panel + sash accents
    accent(colors, "panelTitle.activeBorder", "fill");
    accent(colors, "sash.hoverBorder", "fill");

    // Editor cursor
    accent(colors, "editorCursor.foreground", "fill");

    // Status bar (the bottom bar): the canvas with the muted ink, not an
    // accent strip (the registry default is the Theia/VS Code blue). The CSS
    // layer in SpexrThemeContribution says the same; registering it here too
    // keeps the strip from flashing the accent before that layer lands.
    for (const id of ["statusBar.background", "statusBar.noFolderBackground"]) {
      colors.register({
        id,
        defaults: { dark: SPEXR_NEUTRALS.dark.canvas, light: SPEXR_NEUTRALS.light.canvas },
        description: `SPEXR: ${id} on the SPEXR canvas neutral.`,
      });
    }
    colors.register({
      id: "statusBar.foreground",
      defaults: { dark: SPEXR_NEUTRALS.dark.fgMuted, light: SPEXR_NEUTRALS.light.fgMuted },
      description: "SPEXR: statusBar.foreground in the SPEXR muted ink.",
    });
    accent(colors, "statusBar.focusBorder", "fill");
    // statusBarItem.hoverBackground is deliberately NOT accented: the bar's
    // foreground is muted, and muted text on the light violet hover is ~1.9:1.
    // SpexrThemeContribution gives it a neutral raise instead.

    // A status item that paints a ground of its own. A plugin's item is
    // painted inline with the literal the registry resolves, which the CSS
    // layer never reaches; Theia's plugin API lets it ask for the error,
    // warning, prominent, remote and offline grounds. Each is a kit fill with
    // the kit's label: the fill reads at least 3:1 against the canvas it sits
    // on, the label at least 4.5:1 on the fill (contrast.test.ts).
    // - error and warning: the kit's danger and warning tones;
    // - prominent and remote: neutral, the muted ink as a fill (Theia's
    //   prominent was a 50% black under the muted ink; its remote, set in the
    //   theme data, a green);
    // - offline: no item colour of that name is registered, so the plugin's
    //   item gets no ground, as before.
    // Theia's built-in theme data sets the light error and both remote colours,
    // and theme data outranks a registry default: status-theme-data.ts takes
    // them out of it. spexr's high contrast is Theia's dark one (hc-theia),
    // which keeps its own.
    const grounds: ReadonlyArray<[string, { dark: string; light: string }]> = [
      ["error", { dark: KIT_STATUS_FILL.dark.danger, light: KIT_STATUS_FILL.light.danger }],
      ["warning", { dark: KIT_STATUS_FILL.dark.warning, light: KIT_STATUS_FILL.light.warning }],
      ["prominent", { dark: SPEXR_NEUTRALS.dark.fgMuted, light: SPEXR_NEUTRALS.light.fgMuted }],
      ["remote", { dark: SPEXR_NEUTRALS.dark.fgMuted, light: SPEXR_NEUTRALS.light.fgMuted }],
    ];
    for (const [item, fill] of grounds) {
      colors.register(
        {
          id: `statusBarItem.${item}Background`,
          defaults: fill,
          description: `SPEXR: statusBarItem.${item}Background, a kit fill.`,
        },
        {
          id: `statusBarItem.${item}Foreground`,
          defaults: { dark: labelOn(fill.dark), light: labelOn(fill.light) },
          description: `SPEXR: statusBarItem.${item}Foreground, the kit's label on its fill.`,
        },
      );
    }

    // Tree / list selection is contested: Theia core's CommonFrontendContribution
    // re-registers list.* with its blue after this runs, so the override lives in
    // SpexrThemeContribution's CSS !important layer instead. It is not
    // registered here on purpose: the tile is found by the seam spexr.css draws
    // on Theia's own rows, and Monaco's lists (suggest, code actions) would get
    // the tile without it, white on a white widget on light.

    // xterm and Monaco's minimap paint onto a canvas from the *registry*
    // value, so neither the CSS `--theia-terminal-background` override in
    // SpexrThemeContribution nor an island's re-bound surfaces (spexr.css)
    // reach them. Deriving them from `editor.background` would take Theia's
    // theme grey (#1e1e1e on dark), which the registry still holds: a slab
    // unrelated to the palette. Register the SPEXR surface directly, the fill
    // of an island at rest (Lumen, S3): a terminal or a minimap reads as part
    // of its island. It was the canvas, a well; with islands the canvas is the
    // frame, so a terminal body read as a hole through its island (1.00:1
    // against the frame). Neither follows a lit island's raised rung.
    for (const id of ["terminal.background", "minimap.background"]) {
      colors.register({
        id,
        defaults: {
          dark: SPEXR_NEUTRALS.dark.surface,
          light: SPEXR_NEUTRALS.light.surface,
          hcDark: "editor.background",
          hcLight: "editor.background",
        },
        description: `SPEXR: ${id} on the SPEXR surface neutral, the fill of an island at rest.`,
      });
    }

    // The terminal's ink, cursor, selection and sixteen ANSI colours, from kit
    // roles (spexr-terminal-palette.ts). Registering an id replaces all four of
    // its defaults, so high contrast is handed Theia's own back: the ANSI
    // colours' from its map, the ink as the theme's foreground, the selection
    // as the editor's, and no cursor colour (the ink).
    const dark = terminalColors("dark");
    const light = terminalColors("light");
    for (const id of Object.keys(dark)) {
      const theia = terminalAnsiColorMap[id]?.defaults;
      const hcDark = id === "terminal.foreground" ? "foreground" : id === "terminal.selectionBackground" ? "editor.selectionBackground" : ColorDefaults.getHCDark(theia);
      const hcLight = id === "terminal.foreground" ? "foreground" : id === "terminal.selectionBackground" ? "editor.selectionBackground" : ColorDefaults.getHCLight(theia);
      colors.register({
        id,
        defaults: { dark: dark[id]!, light: light[id]!, ...(hcDark !== undefined ? { hcDark } : {}), ...(hcLight !== undefined ? { hcLight } : {}) },
        description: `SPEXR: ${id} from the kit's roles.`,
      });
    }
  }
}
