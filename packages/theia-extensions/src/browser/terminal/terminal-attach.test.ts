import { describe, expect, it } from "vitest";
import { attachWidget, detachWidget, fallBackOnContextLoss, type AttachOps } from "./terminal-attach.js";

interface FakeNode {
  isConnected: boolean;
}
interface FakeWidget {
  isAttached: boolean;
  node: FakeNode;
}

/**
 * Mirrors Lumino's strict rules: detach throws unless the widget is flagged
 * attached and its node is in the document; attach throws if it still is.
 */
function strictOps(log: string[]): AttachOps<FakeWidget, FakeNode> {
  return {
    attach(w, host) {
      if (w.isAttached || w.node.isConnected) throw new Error("Widget is already attached.");
      w.node.isConnected = host.isConnected;
      w.isAttached = true;
      log.push("attach");
    },
    detach(w) {
      if (!w.isAttached || !w.node.isConnected) throw new Error("Widget is not attached.");
      w.node.isConnected = false;
      w.isAttached = false;
      log.push("detach");
    },
    park(w) {
      w.node.isConnected = true;
      log.push("park");
    },
  };
}

describe("detachWidget", () => {
  it("detaches a widget still in the document", () => {
    const log: string[] = [];
    const w = { isAttached: true, node: { isConnected: true } };
    detachWidget(w, strictOps(log));
    expect(w.isAttached).toBe(false);
    expect(log).toEqual(["detach"]);
  });

  it("clears the attached flag of a widget whose node was removed behind Lumino's back", () => {
    // React removed the card's DOM before the effect cleanup ran.
    const log: string[] = [];
    const w = { isAttached: true, node: { isConnected: false } };
    detachWidget(w, strictOps(log));
    expect(w.isAttached).toBe(false);
    expect(w.node.isConnected).toBe(false);
    expect(log).toEqual(["park", "detach"]);
  });

  it("leaves a widget that is not attached alone", () => {
    const log: string[] = [];
    detachWidget({ isAttached: false, node: { isConnected: false } }, strictOps(log));
    expect(log).toEqual([]);
  });
});

describe("attachWidget", () => {
  it("reattaches a terminal whose previous card was torn down without a clean detach", () => {
    const log: string[] = [];
    const ops = strictOps(log);
    const w = { isAttached: true, node: { isConnected: false } };
    attachWidget(w, { isConnected: true }, ops);
    expect(w.isAttached).toBe(true);
    expect(log).toEqual(["park", "detach", "attach"]);
  });

  it("attaches a fresh widget directly", () => {
    const log: string[] = [];
    const w = { isAttached: false, node: { isConnected: false } };
    attachWidget(w, { isConnected: true }, strictOps(log));
    expect(log).toEqual(["attach"]);
  });
});

describe("fallBackOnContextLoss", () => {
  it("disposes the WebGL renderer once its context is lost for good", () => {
    let fire: () => void = () => {};
    let disposed = 0;
    const addon = {
      onContextLoss: (cb: () => void) => {
        fire = cb;
        return { dispose: () => {} };
      },
      dispose: () => disposed++,
    };
    fallBackOnContextLoss({ webglAddon: addon });
    expect(disposed).toBe(0);
    fire();
    expect(disposed).toBe(1);
  });

  it("does nothing on a terminal without a WebGL renderer", () => {
    expect(fallBackOnContextLoss({})).toBeUndefined();
  });
});
