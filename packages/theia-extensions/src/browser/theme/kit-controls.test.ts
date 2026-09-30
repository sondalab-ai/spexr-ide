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
