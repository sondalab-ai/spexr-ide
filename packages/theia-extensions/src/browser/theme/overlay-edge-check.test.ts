import { describe, expect, it } from "vitest";
import { checkEdge, edgePoints } from "../../../../../tests/visual/checks";

type Rgb = [number, number, number];
const EDGE: Rgb = [113, 114, 118];
const GROUND: Rgb = [20, 20, 24];
const FILL: Rgb = [38, 38, 44];
const run = (c: Rgb, n = 5): Rgb[] => Array.from({ length: n }, () => c);

// The parity capture samples an overlay's edge, the ground outside it and its
// fill. The toast sits over the terminal's text in the base fixture, so one
// pixel read a glyph as the ground; each colour is the median of a run of rows.
describe("the overlay edge check's sampling", () => {
  it("asks for five rows of the edge, the ground and the fill, in that order", () => {
    const pts = edgePoints({ x: 656, y: 789, w: 360, h: 63 });
    expect(pts).toHaveLength(15);
    expect(new Set(pts.slice(0, 5).map((p) => p.x))).toEqual(new Set([655]));
    expect(new Set(pts.slice(5, 10).map((p) => p.x))).toEqual(new Set([650]));
    expect(new Set(pts.slice(10).map((p) => p.x))).toEqual(new Set([659]));
    expect(new Set(pts.slice(0, 5).map((p) => p.y)).size).toBe(5);
  });

  it("stays inside a short box", () => {
    const ys = edgePoints({ x: 0, y: 100, w: 50, h: 20 }).map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...ys)).toBeLessThanOrEqual(120);
  });

  it("passes a clean edge", () => {
    expect(checkEdge("toast", [...run(EDGE), ...run(GROUND), ...run(FILL)])).toEqual([]);
  });

  it("passes when one ground sample is a text pixel (the glyph behind the toast)", () => {
    const ground: Rgb[] = [GROUND, GROUND, [29, 71, 130], GROUND, GROUND];
    expect(checkEdge("toast", [...run(EDGE), ...ground, ...run(FILL)])).toEqual([]);
  });

  it("still fails an edge that is genuinely low-contrast against the ground or the fill", () => {
    const dim: Rgb = [30, 30, 34];
    expect(checkEdge("toast", [...run(dim), ...run(GROUND), ...run(FILL)]).length).toBeGreaterThan(0);
    const onGround = checkEdge("toast", [...run(EDGE), ...run([105, 106, 110]), ...run(FILL)]);
    expect(onGround).toHaveLength(1);
    expect(onGround[0]).toContain("on the ground");
  });

  it("fails when the text covers most of the ground rows", () => {
    const text: Rgb = [105, 106, 110];
    expect(checkEdge("toast", [...run(EDGE), text, text, text, GROUND, GROUND, ...run(FILL)]).length).toBeGreaterThan(0);
  });

  it("reports no pixels for an incomplete sample", () => {
    expect(checkEdge("toast", [])).toEqual(["toast: no pixels sampled"]);
    expect(checkEdge("toast", [EDGE, GROUND])).toEqual(["toast: no pixels sampled"]);
  });
});
