import { describe, expect, it } from "vitest";
import { SpexrDarkfactorySidebarPolicy, type RightPanelShell } from "./darkfactory-sidebar-policy.js";
import { DARKFACTORY_VIEW_ID } from "./darkfactory-view-id.js";
import { MIN_RIGHT_PANEL_WIDTH } from "../shell/side-panel.js";

const OTHER_VIEW_ID = "spexr.view.spec";
const EXPAND_CALLS = ["expand:right", `resize:${MIN_RIGHT_PANEL_WIDTH}`];

interface Harness {
  policy: SpexrDarkfactorySidebarPolicy;
  calls: string[];
  setCurrent: (id: string) => void;
  setExpanded: (expanded: boolean) => void;
  isExpanded: () => boolean;
  /** Releases the pending expand animation, mirroring Theia's `pendingUpdate`. */
  settleExpand: () => void;
}

function makeHarness(options: { current: string; expanded?: boolean; manualExpand?: boolean }): Harness {
  const calls: string[] = [];
  let current = options.current;
  let expanded = options.expanded ?? true;
  let settleExpand = (): void => {};
  const state = { pendingUpdate: Promise.resolve() };
  const shell: RightPanelShell = {
    getCurrentWidget: () => ({ id: current }),
    isExpanded: () => expanded,
    collapsePanel: async (area) => {
      calls.push(`collapse:${area}`);
      expanded = false;
    },
    leftPanelHandler: {},
    rightPanelHandler: {
      expand: () => {
        calls.push("expand:right");
        if (!options.manualExpand) {
          expanded = true;
          return;
        }
        state.pendingUpdate = new Promise<void>((resolve) => {
          settleExpand = () => {
            expanded = true;
            resolve();
          };
        });
      },
      resize: (size: number) => calls.push(`resize:${size}`),
      getPanelSize: () => 0,
      state,
    },
  };
  return {
    policy: new SpexrDarkfactorySidebarPolicy(shell),
    calls,
    setCurrent: (id) => {
      current = id;
    },
    setExpanded: (value) => {
      expanded = value;
    },
    isExpanded: () => expanded,
    settleExpand: () => settleExpand(),
  };
}

describe("SpexrDarkfactorySidebarPolicy", () => {
  it("collapses the right panel when Darkfactory comes to the front", async () => {
    const h = makeHarness({ current: OTHER_VIEW_ID });
    h.setCurrent(DARKFACTORY_VIEW_ID);
    await h.policy.sync();
    expect(h.calls).toEqual(["collapse:right"]);
  });

  it("restores the panel when leaving Darkfactory for a project tab", async () => {
    const h = makeHarness({ current: DARKFACTORY_VIEW_ID });
    await h.policy.sync();
    h.setCurrent(OTHER_VIEW_ID);
    await h.policy.sync();
    expect(h.calls).toEqual(["collapse:right", ...EXPAND_CALLS]);
  });

  it("ignores current-widget events that do not cross the Darkfactory boundary", async () => {
    const h = makeHarness({ current: DARKFACTORY_VIEW_ID });
    await h.policy.sync();
    h.calls.length = 0;
    await h.policy.sync();
    await h.policy.sync();
    expect(h.calls).toEqual([]);
  });

  it("leaves a user-collapsed panel closed after a Darkfactory round trip", async () => {
    const h = makeHarness({ current: OTHER_VIEW_ID, expanded: false });
    h.setCurrent(DARKFACTORY_VIEW_ID);
    await h.policy.sync();
    h.setCurrent(OTHER_VIEW_ID);
    await h.policy.sync();
    expect(h.calls).toEqual([]);
    expect(h.isExpanded()).toBe(false);
  });

  it("leaves the panel alone when the user expanded it while on Darkfactory", async () => {
    const h = makeHarness({ current: DARKFACTORY_VIEW_ID, expanded: false });
    await h.policy.sync();
    h.setExpanded(true);
    h.setCurrent(OTHER_VIEW_ID);
    await h.policy.sync();
    expect(h.calls).toEqual([]);
    expect(h.isExpanded()).toBe(true);
  });

  it("queues a tab switch made while the expand animation is still running", async () => {
    const h = makeHarness({ current: DARKFACTORY_VIEW_ID, expanded: false, manualExpand: true });
    await h.policy.sync(true);
    h.setCurrent(OTHER_VIEW_ID);
    const leaving = h.policy.sync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.setCurrent(DARKFACTORY_VIEW_ID);
    const returning = h.policy.sync();
    h.settleExpand();
    await Promise.all([leaving, returning]);
    expect(h.calls).toEqual([...EXPAND_CALLS, "collapse:right"]);
    expect(h.isExpanded()).toBe(false);
  });

  it("applies the expanded default on launch outside Darkfactory", async () => {
    const h = makeHarness({ current: OTHER_VIEW_ID, expanded: false });
    await h.policy.sync(true);
    expect(h.calls).toEqual(EXPAND_CALLS);
  });

  it("starts collapsed on launch in Darkfactory but reopens on the first project tab", async () => {
    const h = makeHarness({ current: DARKFACTORY_VIEW_ID, expanded: false });
    await h.policy.sync(true);
    expect(h.calls).toEqual([]);
    h.setCurrent(OTHER_VIEW_ID);
    await h.policy.sync();
    expect(h.calls).toEqual(EXPAND_CALLS);
  });
});
