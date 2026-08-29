/**
 * The SPEXR surface neutrals, per theme variant.
 *
 * Shared because two layers need the same values from different directions:
 * `SpexrThemeContribution` writes them into Theia's `--theia-*` CSS variables,
 * while `SpexrColorContribution` must register some of them in the *color
 * registry* — colors that reach a canvas rather than a DOM node (xterm's
 * background) are read from the registry in JavaScript and never see the CSS
 * override. High contrast is left to Theia's own HC theme.
 */
export interface SpexrNeutrals {
  /** Deepest — activity bar, status bar, editor, terminal. */
  canvas: string;
  /** Sidebar, panels, active tab. */
  surface: string;
  /** Menus, dropdowns, widgets, inputs. */
  raised: string;
  fg: string;
  fgMuted: string;
  /** Solid border matching the surfaces. */
  line: string;
}

export const SPEXR_NEUTRALS: { dark: SpexrNeutrals; light: SpexrNeutrals } = {
  dark: {
    canvas: "#070A0D",
    surface: "#0F151A",
    raised: "#131C23",
    fg: "#DAE3E4",
    fgMuted: "#6E8088",
    line: "#1C2830",
  },
  light: {
    canvas: "#ECE4D4",
    surface: "#F6F1E6",
    raised: "#FFFFFF",
    fg: "#15211F",
    fgMuted: "#6E7B78",
    line: "#D8CEBC",
  },
};
