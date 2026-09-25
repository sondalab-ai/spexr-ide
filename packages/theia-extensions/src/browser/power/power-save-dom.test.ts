import { describe, expect, it } from "vitest";
import { POWER_SAVE_ATTRIBUTE, applyPowerSave, isPowerSaving, powerSaveMessage } from "./power-save-dom.js";

/** The slice of an Element the helpers touch, recording every write. */
class FakeElement {
  readonly attrs = new Map<string, string>();
  readonly writes: string[] = [];
  constructor(init: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(init)) this.attrs.set(k, v);
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.writes.push(name);
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  toggleAttribute(name: string, force: boolean): void {
    if (force) this.setAttribute(name, "");
    else this.removeAttribute(name);
  }
}

/** A document whose selectors match by the one attribute they name. */
function fakeDocument(elements: FakeElement[] = []) {
  const doc = {
    documentElement: new FakeElement({ "data-sl-fx": "on" }),
    body: new FakeElement(),
    querySelectorAll: (selector: string) => {
      const name = selector.match(/^\[([\w-]+)\]$/)![1]!;
      return elements.filter((e) => e.hasAttribute(name));
    },
  };
  return { doc, asDocument: doc as unknown as Document };
}

describe("applyPowerSave", () => {
  it("flags the root while saving and leaves the kit's own flag alone", () => {
    const { doc, asDocument } = fakeDocument();
    applyPowerSave(true, asDocument);
    expect(isPowerSaving(asDocument)).toBe(true);
    expect(doc.documentElement.hasAttribute(POWER_SAVE_ATTRIBUTE)).toBe(true);
    applyPowerSave(false, asDocument);
    expect(isPowerSaving(asDocument)).toBe(false);
    expect(doc.documentElement.getAttribute("data-sl-fx")).toBe("on");
    expect(doc.body.hasAttribute("data-sl-fx")).toBe(false);
  });

  it("switches live hosts off and makes the kit re-check them, then back on", () => {
    const host = new FakeElement({ "data-sl-fx-live": "run" });
    const { asDocument } = fakeDocument([host]);
    applyPowerSave(true, asDocument);
    expect(host.getAttribute("data-sl-fx")).toBe("off");
    expect(host.writes.at(-1)).toBe("data-sl-fx-live");
    expect(host.getAttribute("data-sl-fx-live")).toBe("run");
    host.writes.length = 0;
    applyPowerSave(false, asDocument);
    expect(host.hasAttribute("data-sl-fx")).toBe(false);
    expect(host.writes).toEqual(["data-sl-fx-live"]);
  });

  it("leaves a host that opted out on its own opted out after power returns", () => {
    const host = new FakeElement({ "data-sl-fx-live": "run", "data-sl-fx": "off" });
    const { asDocument } = fakeDocument([host]);
    applyPowerSave(true, asDocument);
    applyPowerSave(false, asDocument);
    expect(host.getAttribute("data-sl-fx")).toBe("off");
  });
});

describe("powerSaveMessage", () => {
  it("names the charge and what is paused, and says agents keep running", () => {
    const text = powerSaveMessage(true, 18);
    expect(text).toContain("Battery is at 18%");
    expect(text).toContain("30%");
    expect(text).toContain("Agents");
  });

  it("says what came back", () => {
    expect(powerSaveMessage(false, 40)).toContain("restored");
  });
});
