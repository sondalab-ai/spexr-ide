import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const css = read("../style/spexr.css");

/** The declarations of the first rule whose selector is exactly `selector` in spexr.css. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

// Hand-rolled controls moved onto the kit's classes (0.23): state rides ARIA,
// and spexr's own rules keep layout only, so the kit paints every state.
describe("controls on the kit", () => {
  it("filters search results with kit chips that carry aria-pressed", () => {
    const src = read("../search/smart-search-widget.tsx");
    expect(src).toMatch(/className="sl-chips" role="group"/);
    expect(src).toMatch(/className="sl-chip"\s+aria-pressed=\{/);
    expect(src).not.toMatch(/filter-chip|--cat-color/);
  });

  it("draws the determinate progress bars with sl-progress and their value twice", () => {
    const search = read("../search/smart-search-widget.tsx");
    const stepper = read("../views/spec-workflow-stepper.tsx");
    expect(search.match(/className="sl-progress[^"]*"\s+role="progressbar"/g)).toHaveLength(2);
    expect(search.match(/"--sl-progress":/g)).toHaveLength(2);
    expect(stepper).toMatch(/className="sl-progress"\s+role="progressbar"/);
    expect(stepper).toMatch(/"--sl-progress":/);
  });

  it("lets the kit draw the todo disclosures' chevron", () => {
    const src = read("../todo/todo-widget.tsx");
    expect(src.match(/className="sl-disclosure /g)).toHaveLength(2);
    expect(src).not.toMatch(/codicon-chevron/);
  });

  it("marks the selected schedule task on the kit row itself", () => {
    const src = read("../darkfactory/schedule/schedule-sidebar.tsx");
    expect(src).toMatch(/className="sl-list__row spexr-sched__rowmain"\s+aria-current=/);
  });

  it("splits a card's terminal and browser with the kit resizer", () => {
    expect(read("../darkfactory/agent-tile.tsx")).toMatch(/className="sl-resizer sl-resizer--horizontal spexr-df-split__divider"/);
  });

  it("keeps no local paint for a state the kit already reads", () => {
    expect(css).not.toMatch(/\.sl-segmented__item\[aria-pressed/);
    expect(css).not.toMatch(/smart-search__(progress-(track|fill)|map-fill|filter-)|spexr-progress__(bar|fill)|df-card__chip/);
  });

  it.each([".spexr-df-row", ".spexr-whats-new__dismiss", ".spexr-todo__more, .spexr-todo__done-toggle"])(
    "%s leaves background and colour to the kit",
    (sel) => {
      expect(rule(sel)).not.toMatch(/(^|[\s;{])(background|color):/);
    },
  );
});

// The kit's switch track is border-box since 0.32: the compact track sized
// for a content box left the knob 1px from the edges and 0px on the right
// when on, and the kit's held rules, which outrank a plain knob rule, grew the
// held knob past the track.
describe("the compact switch", () => {
  const px = (sel: string, prop: RegExp): number => {
    const m = prop.exec(rule(sel));
    expect(m, `${prop} in ${sel}`).not.toBeNull();
    return Number(m![1]);
  };
  const HELD = ".spexr-df-switch.sl-switch:active:not(:has(:disabled))";
  const EDGE = 1;
  const INSET = 2; // the kit's knob sits 2px in from the left

  it("keeps the knob 2px in from every side of the border-box track, off and on", () => {
    const width = px(".spexr-df-switch .sl-switch__track", /width:\s*(\d+)px/);
    const height = px(".spexr-df-switch .sl-switch__track", /height:\s*(\d+)px/);
    const knob = px(".spexr-df-switch .sl-switch__track::after", /width:\s*(\d+)px/);
    const travel = px(".spexr-df-switch .sl-switch__input:checked + .sl-switch__track::after", /translateX\((\d+)px\)/);
    expect((height - 2 * EDGE - knob) / 2).toBe(INSET);
    expect(width - 2 * EDGE - (INSET + travel + knob)).toBe(INSET);
  });

  it("stretches the held knob inside the track, at the kit's held-rule weights", () => {
    const width = px(".spexr-df-switch .sl-switch__track", /width:\s*(\d+)px/);
    const knob = px(".spexr-df-switch .sl-switch__track::after", /width:\s*(\d+)px/);
    const travel = px(".spexr-df-switch .sl-switch__input:checked + .sl-switch__track::after", /translateX\((\d+)px\)/);
    const held = px(`${HELD} .sl-switch__track::after`, /width:\s*(\d+)px/);
    const heldTravel = px(`${HELD} .sl-switch__input:checked + .sl-switch__track::after`, /translateX\((\d+)px\)/);
    expect(held).toBeGreaterThan(knob);
    expect(INSET + held).toBeLessThanOrEqual(width - 2 * EDGE - INSET);
    expect(INSET + heldTravel + held).toBe(INSET + travel + knob);
  });
});
