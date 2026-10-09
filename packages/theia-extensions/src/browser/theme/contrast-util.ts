/** WCAG contrast and alpha compositing on `#rrggbb[aa]` colours, for the tests that gate the editor and terminal palettes. */

type Rgb = [number, number, number];

const channels = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const linear = (c: number): number => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance of a `#rrggbb`. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two opaque `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** A `#rrggbbaa` painted over an opaque `#rrggbb`, per channel, as a browser composites it; the result is `#rrggbb`. */
export function over(wash: string, ground: string): string {
  if (!/^#[0-9a-f]{8}$/i.test(wash)) throw new Error(`not a #rrggbbaa colour: ${wash}`);
  const alpha = parseInt(wash.slice(7, 9), 16) / 255;
  const top = channels(wash);
  const bottom = channels(ground);
  return `#${top.map((c, i) => Math.round(bottom[i]! + (c - bottom[i]!) * alpha).toString(16).padStart(2, "0")).join("")}`;
}
