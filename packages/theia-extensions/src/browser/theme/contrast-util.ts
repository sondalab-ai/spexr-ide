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

/**
 * A `#rrggbbaa` painted over an opaque `#rrggbb`, per channel; the result is
 * `#rrggbb`. The alpha is the one Monaco's CSS carries, the byte over 255
 * rounded to two decimals (`+(a).toFixed(2)`), which is what is painted.
 */
export function over(wash: string, ground: string): string {
  if (!/^#[0-9a-f]{8}$/i.test(wash)) throw new Error(`not a #rrggbbaa colour: ${wash}`);
  const alpha = Math.round((parseInt(wash.slice(7, 9), 16) / 255) * 100) / 100;
  const top = channels(wash);
  const bottom = channels(ground);
  return `#${top.map((c, i) => Math.round(bottom[i]! + (c - bottom[i]!) * alpha).toString(16).padStart(2, "0")).join("")}`;
}

const gamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** A `#rrggbb` as OKLCH `[L, C, h°]`. */
export function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(linear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}

/** OKLCH as `#rrggbb`, each channel clipped to the gamut as Chrome paints it. */
export function fromOklch([L, C, h]: [number, number, number]): string {
  const A = C * Math.cos((h * Math.PI) / 180);
  const B = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${lin.map((c) => Math.round(255 * Math.min(1, Math.max(0, gamma(Math.min(1, Math.max(0, c)))))).toString(16).padStart(2, "0")).join("")}`;
}
