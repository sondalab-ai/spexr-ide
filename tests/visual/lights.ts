import sharp from "sharp";

/** A rect in CSS px or points, as `meta.page.parity` records them. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One traffic light found in a native capture, in points; right and bottom exclusive. */
export interface Circle {
  readonly colour: "red" | "yellow" | "green";
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** What the capture found and checked of macOS's traffic lights in one native capture. */
export interface LightsCheck {
  readonly file: string;
  /** Image pixels per point: the PNG's width over the window's. */
  readonly scale: number;
  readonly circles: Circle[];
  /** The page's zoom factor when the capture was taken. */
  readonly factor: number;
  /** The bar's centre, in points from the window's top. */
  readonly barCentre: number | null;
  readonly ok: boolean;
  readonly problems: string[];
}

/** The lights' saturated colours, unfocused grey excluded: the capture focuses the window first. */
function lightColour(r: number, g: number, b: number): Circle["colour"] | null {
  if (r > 180 && g < 140 && b < 140) return "red";
  if (r > 180 && g > 140 && b < 120) return "yellow";
  if (g > 150 && r < 150 && b < 150) return "green";
  return null;
}

/**
 * The traffic lights in a native window capture (native.ts), by colour, in
 * the top-left 200×80pt: one bounding box per colour, in points.
 */
export async function findLights(file: string, windowWidth: number): Promise<{ scale: number; circles: Circle[] }> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const scale = info.width / windowWidth;
  const rows = Math.min(info.height, Math.round(80 * scale));
  const cols = Math.min(info.width, Math.round(200 * scale));
  const boxes = new Map<Circle["colour"], { x0: number; y0: number; x1: number; y1: number }>();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * info.width + x) * info.channels;
      const colour = lightColour(data[i]!, data[i + 1]!, data[i + 2]!);
      if (!colour) continue;
      const box = boxes.get(colour) ?? { x0: x, y0: y, x1: x, y1: y };
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x);
      box.y1 = Math.max(box.y1, y);
      boxes.set(colour, box);
    }
  }
  const circles = [...boxes].map(([colour, b]) => ({
    colour,
    left: b.x0 / scale,
    top: b.y0 / scale,
    right: (b.x1 + 1) / scale,
    bottom: (b.y1 + 1) / scale,
  }));
  return { scale, circles: circles.sort((a, b) => a.left - b.left) };
}

/**
 * The lights against spexr's bar: all three found, each centred within 1pt
 * of the bar's centre, and, when `dots` is given (100% zoom, where the room
 * and the lights are the same pixels), inside the bar's room for them, with
 * 1pt for anti-aliasing. `bar` and `dots` are in CSS px, scaled by `factor`.
 */
export function checkLights(file: string, found: { scale: number; circles: Circle[] }, factor: number, bar?: Rect, dots?: Rect): LightsCheck {
  const problems: string[] = [];
  const barCentre = bar ? (bar.y + bar.h / 2) * factor : null;
  if (found.circles.length !== 3) problems.push(`found ${found.circles.length} lights, not 3`);
  if (barCentre === null) problems.push("no title bar rect");
  for (const c of found.circles) {
    const centre = (c.top + c.bottom) / 2;
    if (barCentre !== null && Math.abs(centre - barCentre) > 1) problems.push(`${c.colour} centre y ${centre} is not within 1pt of the bar's ${barCentre}`);
    if (dots) {
      const inside = c.left >= dots.x - 1 && c.right <= dots.x + dots.w + 1 && c.top >= dots.y - 1 && c.bottom <= dots.y + dots.h + 1;
      if (!inside) problems.push(`${c.colour} ${c.left},${c.top}–${c.right},${c.bottom} is outside title.dots ${dots.x},${dots.y} ${dots.w}×${dots.h}`);
    }
  }
  return { file, scale: found.scale, circles: found.circles, factor, barCentre, ok: problems.length === 0, problems };
}
