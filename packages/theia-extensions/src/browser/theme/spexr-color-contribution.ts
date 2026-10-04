import { injectable } from "@theia/core/shared/inversify";
import type { ColorContribution } from "@theia/core/lib/browser/color-application-contribution";
import type { ColorRegistry } from "@theia/core/lib/browser/color-registry";
import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";
import { ACCENT, ACCENT_FILL, accentText, accentTextActive, mixBlack } from "./spexr-accent.js";

/** The label on a labelled accent fill. */
const ON_ACCENT = "#ffffff";

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
 * with its derived hover ("labelled", "labelledHover").
 */
function accent(
  colors: ColorRegistry,
  id: string,
  variant: "fill" | "text" | "textActive" | "onAccent" | "labelled" | "labelledHover",
): void {
  const value =
    variant === "onAccent"
      ? { dark: ON_ACCENT, light: ON_ACCENT }
      : variant === "text"
        ? { dark: accentText("dark"), light: accentText("light") }
        : variant === "textActive"
          ? { dark: accentTextActive("dark"), light: accentTextActive("light") }
          : variant === "labelled"
            ? { dark: ACCENT_FILL.dark, light: ACCENT_FILL.light }
            : variant === "labelledHover"
              ? { dark: mixBlack(ACCENT_FILL.dark, 0.89), light: mixBlack(ACCENT_FILL.light, 0.89) }
              : { dark: ACCENT.dark, light: ACCENT.light };
  colors.register({
    id,
    defaults: value,
    description: `SPEXR: violet accent override for ${id}.`,
  });
}

/**
 * Overrides Theia's blue accent with the SPEXR violet, and darkens the embedded
 * Claude terminal so it reads apart from the editor.
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

    // Native buttons and badges carry a white label: the registered fill
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

    // Tree / list selection is contested: Theia core's CommonFrontendContribution
    // re-registers list.* with its blue after this runs, so the override lives in
    // SpexrThemeContribution's CSS !important layer instead. It is not
    // registered here on purpose: the tile is found by the seam spexr.css draws
    // on Theia's own rows, and Monaco's lists (suggest, code actions) would get
    // the tile without it, white on a white widget on light.

    // xterm paints onto a canvas from the *registry* value, so the CSS
    // `--theia-terminal-background` override in SpexrThemeContribution never
    // reaches it. Deriving this from `editor.background` would darken Theia's
    // default gray — the registry never sees our canvas — which is how the
    // terminal ended up a black unrelated to the palette. Register the SPEXR
    // canvas directly: it still reads apart from the panel around it, which is
    // one step lighter.
    colors.register({
      id: "terminal.background",
      defaults: {
        dark: SPEXR_NEUTRALS.dark.canvas,
        light: SPEXR_NEUTRALS.light.canvas,
        hcDark: "editor.background",
        hcLight: "editor.background",
      },
      description: "SPEXR: terminal background on the SPEXR canvas neutral.",
    });
  }
}
