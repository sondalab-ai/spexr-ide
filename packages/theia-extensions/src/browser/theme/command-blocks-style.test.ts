import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { TERMINAL_BLOCK } from "../shell/workbench-geometry.js";
import { MAX_BLOCKS } from "../terminal/command-blocks-controller.js";
import { contrastRatio, fromOklch, toOklch } from "./contrast-util.js";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const css = read("../style/spexr.css").replace(/\/\*[\s\S]*?\*\//g, "");
const kitDir = dirname(createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.js"));
const kitFile = (name: string): string => readFileSync(join(kitDir, name), "utf8");
const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim().replace(/\s+/g, " "), body: m[2]! }));
const rules = (selector: string): string => {
  const found = RULES.filter((r) => r.selector.split(/\s*,\s*(?![^(]*\))/).includes(selector)).map((r) => r.body);
  expect(found.length, `${selector} not found in spexr.css`).toBeGreaterThan(0);
  return found.join("\n");
};
const px = (body: string, name: string): number => {
  const m = new RegExp(`(?:^|[\\s;])${name}:\\s*(-?[\\d.]+)px`).exec(body);
  expect(m, `${name} in ${body.slice(0, 120)}`).not.toBeNull();
  return Number(m![1]);
};

// The numbers repeat TERMINAL_BLOCK in shell/workbench-geometry.ts: CSS cannot read it.
describe("the terminal command block in spexr.css", () => {
  it("is the table's frame: r8 and a 1px inset ring on the kit's control edge, outside the lines at the sides only, so it never bleeds into the previous row", () => {
    const frame = rules('.spexr-term-block[data-frame="true"]::after');
    expect(px(frame, "border-radius")).toBe(TERMINAL_BLOCK.radius);
    expect(frame).toMatch(new RegExp(`inset:\\s*${TERMINAL_BLOCK.frameOutsetY} -${TERMINAL_BLOCK.frameOutsetX}px`));
    expect(frame).toMatch(new RegExp(`box-shadow:\\s*inset 0 0 0 ${TERMINAL_BLOCK.ring}px var\\(--slc-edge-control\\)`));
  });

  it("rings a failure in the danger tone whole, in place of the control edge", () => {
    expect(rules('.spexr-term-block[data-frame="true"][data-exit]:not([data-exit="0"], [data-exit="cancelled"])::after')).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--slc-danger\)/);
  });

  it("is the kit's seam: 2px high with a rounded bottom, 44 long, 12 in, in the exit tone", () => {
    const seam = rules('.spexr-term-block[data-frame="true"]::before');
    expect(px(seam, "height")).toBe(TERMINAL_BLOCK.seamHeight);
    expect(seam).toMatch(/border-radius:\s*0 0 2px 2px/);
    expect(px(seam, "width")).toBe(TERMINAL_BLOCK.seamWidth);
    expect(px(seam, "left")).toBe(TERMINAL_BLOCK.seamInset);
    expect(seam).toMatch(/background-color:\s*var\(--_spexr-exit\)/);
  });

  it("fades the command under the chip over 16px, and sets the chip in the code face first", () => {
    const fade = rules(".spexr-term-block__meta::before");
    expect(px(fade, "width")).toBe(TERMINAL_BLOCK.metaFade);
    expect(px(fade, "left")).toBe(-TERMINAL_BLOCK.metaFade);
    expect(fade).toMatch(/linear-gradient\(to right, transparent, var\(--slc-surface\)\)/);
    expect(rules(".spexr-term-block")).toMatch(/font-family:\s*var\(--sl-font-code, var\(--sl-font-mono\)\)/);
  });

  it("is the table's chip: the code face at 11.5px on a 16px line, 8px from the right, 12px between its parts, muted, with the exit in its tone", () => {
    expect(px(rules(".spexr-term-block"), "font-size")).toBe(TERMINAL_BLOCK.metaSize);
    const meta = rules(".spexr-term-block__meta");
    expect(px(meta, "line-height")).toBe(TERMINAL_BLOCK.metaLine);
    expect(px(meta, "right")).toBe(TERMINAL_BLOCK.metaInset);
    expect(px(meta, "gap")).toBe(TERMINAL_BLOCK.metaGap);
    expect(meta).toMatch(/color:\s*var\(--slc-text-muted\)/);
    expect(meta).toMatch(/background-color:\s*var\(--slc-surface\)/);
    expect(rules(".spexr-term-block__exit")).toMatch(/color:\s*var\(--_spexr-exit\)/);
  });

  it("takes no pointer and fills no line, so the terminal's own text and ground show", () => {
    const root = rules(".spexr-term-block");
    expect(root).toMatch(/pointer-events:\s*none/);
    expect(root).not.toMatch(/background/);
  });

  it("keeps the table's block count in step with the controller's", () => {
    expect(TERMINAL_BLOCK.maxBlocks).toBe(MAX_BLOCKS);
  });

  it("draws a frame in forced colours, where shadows go", () => {
    expect(css).toMatch(/@media \(forced-colors: active\)\s*\{[\s\S]*?outline:\s*1px solid CanvasText/);
  });

  it("writes no colour literal, and does not animate", () => {
    for (const r of RULES.filter((x) => /spexr-term-block/.test(x.selector))) {
      expect(r.body, r.selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch)\(|\banimation\b|\btransition\b/);
    }
  });
});

describe("the command blocks' sources", () => {
  it("builds the chip from text, and takes Theia's own marks through while taking spexr's", () => {
    const model = read("../terminal/command-blocks.ts");
    expect(model).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    const controller = read("../terminal/command-blocks-controller.ts");
    expect(controller).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    expect(controller).toMatch(/if \(!isSpexrPayload\(payload\)\) return false;/);
  });

  it("skips the agent terminal and the Dark Factory sessions, and sits behind a preference and Theia's command history", () => {
    const src = read("../terminal/command-blocks-contribution.ts");
    expect(src).toMatch(/terminalKindOf\(widget\.kind\) !== "editor"/);
    expect(src).toMatch(/SPEXR_TERMINAL_COMMAND_BLOCKS_PREFERENCE/);
    expect(src).toMatch(/terminal\.integrated\.enableCommandHistory/);
    expect(JSON.parse(read("../../../../../apps/desktop/package.json")).theia.frontend.config.preferences["terminal.integrated.enableCommandHistory"]).toBe(true);
    expect(read("../preferences/spexr-preferences.ts")).toMatch(/\[SPEXR_TERMINAL_COMMAND_BLOCKS_PREFERENCE\]: \{\s*type: "boolean",\s*default: true/);
  });
});

type Theme = "dark" | "light";
const neutrals = kitNeutrals.products.spexr as unknown as Record<Theme, Record<string, string>>;
const status = (theme: Theme, name: "success" | "danger"): string => new RegExp(`--sl-status-${name}:\\s*(#[0-9a-f]{6})`).exec(kitFile(`themes/${theme}.css`))![1]!;

// The owner's rules: text at least 4.5:1; a boundary or a state indicator at least 3:1.
describe.each(["dark", "light"] as const)("the command block on %s", (theme) => {
  const ground = neutrals[theme]["bg-surface"]!;
  const edge = ((): string => {
    const k = kitFile("components.css");
    const step = Number(/--slc-shade-step:\s*([\d.]+)/.exec(k)![1]);
    const steps = Number(/--slc-edge-control-steps:\s*([\d.]+)/.exec(k)![1]);
    const [L, C, h] = toOklch(ground);
    return fromOklch([theme === "dark" ? L + step * steps : L - step * (steps + 0.5), C, h]);
  })();
  const atLeast = (min: number, ink: string, bg: string, label: string): void => {
    expect(contrastRatio(ink, bg), label).toBeGreaterThanOrEqual(min);
  };

  it("reads the chip's time and duration (muted) at 4.5:1 on the terminal's ground", () => {
    atLeast(4.5, neutrals[theme]["text-muted"]!, ground, "time and duration");
  });

  it("reads the exit text at 4.5:1 in each tone: success, danger, and the muted ink of a running command or a cancelled one", () => {
    atLeast(4.5, status(theme, "success"), ground, "exit 0");
    atLeast(4.5, status(theme, "danger"), ground, "exit 1");
    atLeast(4.5, neutrals[theme]["text-muted"]!, ground, "running and cancelled");
    expect(rules(".spexr-term-block")).toMatch(/--_spexr-exit:\s*var\(--slc-text-muted\)/);
  });

  it("draws the ring at 3:1 (the control edge, and the danger tone) and the seams at 3:1", () => {
    atLeast(3, edge, ground, "ring");
    atLeast(3, status(theme, "danger"), ground, "failure ring");
    atLeast(3, status(theme, "success"), ground, "success seam");
    atLeast(3, status(theme, "danger"), ground, "failure seam");
    atLeast(3, neutrals[theme]["text-muted"]!, ground, "cancelled seam");
  });
});
