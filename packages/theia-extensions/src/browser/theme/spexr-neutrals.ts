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
    fgMuted: "#7C8D95",
    line: "#1C2830",
  },
  light: {
    canvas: "#F4F4F8",
    surface: "#FAFAFC",
    raised: "#FFFFFF",
    fg: "#1C1D22",
    fgMuted: "#5F6374",
    line: "#D6D7D9",
  },
};
