import { describe, expect, test } from "vitest";
import {
  consumeProjectLanding,
  rememberProjectLanding,
  LANDING_INTENT_KEY,
  type IntentStorage,
} from "./project-landing-intent.js";

/** In-memory `IntentStorage`; `throwOn` simulates a storage that refuses access. */
function makeStorage(throwOn?: "get" | "set"): IntentStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem(key) {
      if (throwOn === "get") throw new Error("blocked");
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      if (throwOn === "set") throw new Error("quota");
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

describe("project landing intent", () => {
  test("reports a landing when the loaded root is the one the switch aimed at", () => {
    const storage = makeStorage();
    rememberProjectLanding(storage, "/home/me/app");
    expect(consumeProjectLanding(storage, "/home/me/app")).toBe(true);
  });

  test("ignores an intent pointing at a different project", () => {
    const storage = makeStorage();
    rememberProjectLanding(storage, "/home/me/app");
    expect(consumeProjectLanding(storage, "/home/me/other")).toBe(false);
  });

  test("clears the intent even when it does not match, so it cannot fire later", () => {
    const storage = makeStorage();
    rememberProjectLanding(storage, "/home/me/app");
    consumeProjectLanding(storage, "/home/me/other");
    expect(storage.map.has(LANDING_INTENT_KEY)).toBe(false);
  });

  test("is one-shot: a second launch on the same project is not a landing", () => {
    const storage = makeStorage();
    rememberProjectLanding(storage, "/home/me/app");
    consumeProjectLanding(storage, "/home/me/app");
    expect(consumeProjectLanding(storage, "/home/me/app")).toBe(false);
  });

  test("compares paths that differ only by a trailing slash", () => {
    const storage = makeStorage();
    rememberProjectLanding(storage, "/home/me/app/");
    expect(consumeProjectLanding(storage, "/home/me/app")).toBe(true);
  });

  test("reports no landing when no workspace root is loaded", () => {
    const storage = makeStorage();
    rememberProjectLanding(storage, "/home/me/app");
    expect(consumeProjectLanding(storage, undefined)).toBe(false);
  });

  test("reports no landing when nothing was stored", () => {
    expect(consumeProjectLanding(makeStorage(), "/home/me/app")).toBe(false);
  });

  test("survives a storage that refuses reads or writes", () => {
    expect(consumeProjectLanding(makeStorage("get"), "/home/me/app")).toBe(false);
    expect(() => rememberProjectLanding(makeStorage("set"), "/home/me/app")).not.toThrow();
  });
});
