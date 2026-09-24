import { describe, expect, it } from "vitest";
import { enableUnicode11, type XtermUnicodeLike } from "./terminal-unicode.js";

/** An xterm stand-in that, like the real one, refuses `unicode` unless proposed APIs are allowed. */
function fakeXterm(allowProposedApi?: boolean): XtermUnicodeLike & { addons: unknown[]; version: string } {
  const term = {
    options: { allowProposedApi },
    addons: [] as unknown[],
    version: "6",
    loadAddon(addon: unknown) {
      if (!term.options.allowProposedApi) throw new Error("proposed API not allowed");
      term.addons.push(addon);
    },
    get unicode() {
      if (!term.options.allowProposedApi) throw new Error("proposed API not allowed");
      return {
        get activeVersion() {
          return term.version;
        },
        set activeVersion(v: string) {
          term.version = v;
        },
      };
    },
  };
  return term;
}

describe("enableUnicode11", () => {
  it("loads the addon and makes Unicode 11 the active width table", () => {
    const term = fakeXterm();
    const addon = {};
    enableUnicode11(term, () => addon);
    expect(term.addons).toEqual([addon]);
    expect(term.version).toBe("11");
  });

  it("loads the addon only once when called again on the same terminal", () => {
    const term = fakeXterm();
    enableUnicode11(term, () => ({}));
    enableUnicode11(term, () => ({}));
    expect(term.addons).toHaveLength(1);
    expect(term.options.allowProposedApi).toBeUndefined();
  });

  it.each([undefined, false, true])("puts allowProposedApi back to %s", (before) => {
    const term = fakeXterm(before);
    enableUnicode11(term, () => ({}));
    expect(term.options.allowProposedApi).toBe(before);
  });

  it("puts allowProposedApi back when the switch fails", () => {
    const term = fakeXterm(false);
    term.loadAddon = () => {
      throw new Error("boom");
    };
    expect(() => enableUnicode11(term, () => ({}))).toThrow("boom");
    expect(term.options.allowProposedApi).toBe(false);
  });
});
