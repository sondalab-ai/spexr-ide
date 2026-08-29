import { injectable } from "@theia/core/shared/inversify";
import type { ColorContribution } from "@theia/core/lib/browser/color-application-contribution";
import type { ColorRegistry } from "@theia/core/lib/browser/color-registry";
import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";

/** SPEXR violet accent, per theme variant. */
const ACCENT = {
  dark: "#8b96ff",
  light: "#5b6cff",
  darkHover: "#a3acff",
  lightHover: "#4858ee",
  onAccent: "#ffffff",
};

/**
 * One accent-color override. `defaults` map dark/light to the violet (high
 * contrast keeps Theia's own values). These re-register monaco's built-in
 * color ids, whose defaults are the Theia/VS Code blue — registering here
 * replaces the default at the source, so Theia regenerates the matching
 * `--theia-*` CSS variable in violet on every theme change.
 */
function accent(
  colors: ColorRegistry,
  id: string,
  variant: "fill" | "hover" | "onAccent",
): void {
  const value =
    variant === "onAccent"
      ? { dark: ACCENT.onAccent, light: ACCENT.onAccent }
      : variant === "hover"
        ? { dark: ACCENT.darkHover, light: ACCENT.lightHover }
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

    // Native buttons
    accent(colors, "button.background", "fill");
    accent(colors, "button.hoverBackground", "hover");
    accent(colors, "button.foreground", "onAccent");

    // Badges
    accent(colors, "badge.background", "fill");
    accent(colors, "badge.foreground", "onAccent");

    // Progress bar
    accent(colors, "progressBar.background", "fill");

    // Links
    accent(colors, "textLink.foreground", "fill");
    accent(colors, "textLink.activeForeground", "hover");
    accent(colors, "editorLink.activeForeground", "fill");

    // Active tab indicator
    accent(colors, "tab.activeBorderTop", "fill");

    // Activity bar active highlight
    accent(colors, "activityBar.activeBorder", "fill");
    accent(colors, "activityBar.activeFocusBorder", "fill");

    // Input options (e.g. case-sensitive toggle)
    accent(colors, "inputOption.activeBorder", "fill");
    accent(colors, "inputOption.activeForeground", "fill");

    // Quick-pick group label / picker accents
    accent(colors, "pickerGroup.foreground", "fill");

    // Panel + sash accents
    accent(colors, "panelTitle.activeBorder", "fill");
    accent(colors, "sash.hoverBorder", "fill");

    // Editor cursor
    accent(colors, "editorCursor.foreground", "fill");

    // Status bar (the bottom bar) — registry default is the Theia/VS Code blue
    accent(colors, "statusBar.background", "fill");
    accent(colors, "statusBar.foreground", "onAccent");
    accent(colors, "statusBar.noFolderBackground", "fill");
    accent(colors, "statusBar.focusBorder", "fill");
    // statusBarItem.hoverBackground is deliberately NOT accented: the bar's
    // foreground is muted, and muted text on the light violet hover is ~1.9:1.
    // SpexrThemeContribution gives it a neutral raise instead.

    // Tree / list selection is contested: Theia core's CommonFrontendContribution
    // re-registers list.* with its blue after this runs, so the override lives in
    // SpexrThemeContribution's CSS !important layer instead.

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
