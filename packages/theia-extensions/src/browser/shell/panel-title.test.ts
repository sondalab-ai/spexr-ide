import { describe, expect, it } from "vitest";
import { syncPanelTitle, type PanelTitleHandler } from "./panel-title.js";

function handlerShowing(id: string | undefined) {
  const state = { hidden: undefined as boolean | undefined };
  const handler: PanelTitleHandler = {
    tabBar: { currentTitle: id === undefined ? null : { owner: { id } } },
    toolBar: { setHidden: (h) => (state.hidden = h) },
  };
  return { handler, state };
}

const SELF_TITLED = new Set(["spexr.view.memory", "spexr.view.experts"]);

describe("syncPanelTitle", () => {
  it("hides the title row for a view with its own heading", () => {
    const { handler, state } = handlerShowing("spexr.view.experts");
    syncPanelTitle(handler, SELF_TITLED);
    expect(state.hidden).toBe(true);
  });

  it("keeps the title row for a view without one", () => {
    const { handler, state } = handlerShowing("spexr.view.todo");
    syncPanelTitle(handler, SELF_TITLED);
    expect(state.hidden).toBe(false);
  });

  it("keeps the title row when no view is showing", () => {
    const { handler, state } = handlerShowing(undefined);
    syncPanelTitle(handler, SELF_TITLED);
    expect(state.hidden).toBe(false);
  });
});
