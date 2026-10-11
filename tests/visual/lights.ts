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
  /** The mark's left edge from the DOM, and the first column of its ink in the capture, both in points (see {@link inkAfter}). */
  readonly markPt?: number | null;
  readonly markInkPt?: number | null;
}

/**
 * The lights' saturated colours, unfocused grey excluded: the capture focuses
 * the window first. Strict enough that a neighbour's anti-aliased edge (the
 * yellow light's orange rim) is not read as red.
 */
function lightColour(r: number, g: number, b: number): Circle["colour"] | null {
  if (r > 200 && g < 130 && b < 130) return "red";
  if (r > 200 && g > 150 && b < 110) return "yellow";
  if (g > 160 && r < 120 && b < 120) return "green";
  return null;
}

/**
 * The traffic lights in a native window capture (native.ts), by colour, in
 * the top-left 200×80pt: for each colour, the bounding box of its largest
 * connected patch, in points.
 */
export async function findLights(file: string, windowWidth: number): Promise<{ scale: number; circles: Circle[] }> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const scale = info.width / windowWidth;
  const rows = Math.min(info.height, Math.round(80 * scale));
  const cols = Math.min(info.width, Math.round(200 * scale));
  const colourAt = (x: number, y: number): Circle["colour"] | null => {
    const i = (y * info.width + x) * info.channels;
    return lightColour(data[i]!, data[i + 1]!, data[i + 2]!);
  };
  const seen = new Uint8Array(rows * cols);
  const best = new Map<Circle["colour"], { n: number; x0: number; y0: number; x1: number; y1: number }>();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const colour = colourAt(x, y);
      if (!colour || seen[y * cols + x]) continue;
      const patch = { n: 0, x0: x, y0: y, x1: x, y1: y };
      const stack = [[x, y]];
      seen[y * cols + x] = 1;
      while (stack.length) {
        const [px, py] = stack.pop()!;
        patch.n++;
        patch.x0 = Math.min(patch.x0, px!);
        patch.y0 = Math.min(patch.y0, py!);
        patch.x1 = Math.max(patch.x1, px!);
        patch.y1 = Math.max(patch.y1, py!);
        for (const [nx, ny] of [[px! + 1, py!], [px! - 1, py!], [px!, py! + 1], [px!, py! - 1]] as const) {
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen[ny * cols + nx] || colourAt(nx, ny) !== colour) continue;
          seen[ny * cols + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      if (patch.n > (best.get(colour)?.n ?? 0)) best.set(colour, patch);
    }
  }
  const circles = [...best].map(([colour, b]) => ({
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
 * of the bar's centre and inside the bar's room for them (`dots`, from the
 * bar's padding to the lights' right edge), with 1pt for anti-aliasing.
 * `bar` and `dots` are in CSS px, scaled by `factor` into points.
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
      const [x, y, w, h] = [dots.x * factor, dots.y * factor, dots.w * factor, dots.h * factor];
      const inside = c.left >= x - 1 && c.right <= x + w + 1 && c.top >= y - 1 && c.bottom <= y + h + 1;
      if (!inside) problems.push(`${c.colour} ${c.left},${c.top}–${c.right},${c.bottom} is outside title.dots ${x},${y} ${w}×${h} (pt)`);
    }
  }
  return { file, scale: found.scale, circles: found.circles, factor, barCentre, ok: problems.length === 0, problems };
}

/**
 * The first column, in points, where ink starts right of `fromPt` in the
 * bar's middle rows (centre ± 6pt): the mark's first glyph, when `fromPt` is
 * the lights' right edge. The background is sampled 3pt right of `fromPt`,
 * in the gap the bar keeps between the lights and the mark; ink is a pixel
 * more than 60 levels off it in any channel. Null when none in 60pt.
 */
export async function inkAfter(file: string, windowWidth: number, fromPt: number, centrePt: number): Promise<number | null> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const scale = info.width / windowWidth;
  const at = (x: number, y: number): number[] => {
    const i = (y * info.width + x) * info.channels;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
  const x0 = Math.round((fromPt + 3) * scale);
  const yc = Math.round(centrePt * scale);
  const background = at(x0, yc);
  const top = Math.max(0, Math.round((centrePt - 6) * scale));
  const bottom = Math.min(info.height - 1, Math.round((centrePt + 6) * scale));
  for (let x = x0 + 1; x < Math.min(info.width, x0 + Math.round(60 * scale)); x++) {
    for (let y = top; y <= bottom; y++) {
      const pixel = at(x, y);
      if (pixel.some((v, k) => Math.abs(v - background[k]!) > 60)) return x / scale;
    }
  }
  return null;
}
