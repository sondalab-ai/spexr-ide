import { describe, expect, it } from "vitest";
import type { ClaudeConfigDir } from "../../common/darkfactory-protocol.js";
import {
  NEW_SESSION_CONFIG_KEY,
  pickConfigDir,
  readConfigDirChoice,
  writeConfigDirChoice,
  type ChoiceStorage,
} from "./new-session-config.js";

const DEFAULT: ClaudeConfigDir = { path: "/home/u/.claude", label: ".claude", isDefault: true };
const PERSO: ClaudeConfigDir = { path: "/home/u/.claude-perso", label: ".claude-perso", isDefault: false };
const AVAILABLE = [DEFAULT, PERSO];

function fakeStorage(initial?: string): ChoiceStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem() {
      return this.value;
    },
    setItem(_key: string, v: string) {
      this.value = v;
    },
  };
}

describe("pickConfigDir", () => {
  it("keeps a stored choice that is still discovered", () => {
    expect(pickConfigDir(PERSO.path, AVAILABLE)).toBe(PERSO.path);
  });

  it("falls back to the default account when nothing is stored", () => {
    expect(pickConfigDir(null, AVAILABLE)).toBe(DEFAULT.path);
  });

  it("drops a stored account that is no longer discovered", () => {
    expect(pickConfigDir("/home/u/.claude-gone", AVAILABLE)).toBe(DEFAULT.path);
  });

  it("takes the first account when none is marked default", () => {
    expect(pickConfigDir(null, [PERSO])).toBe(PERSO.path);
  });

  it("returns an empty path when no account was discovered", () => {
    expect(pickConfigDir(null, [])).toBe("");
  });
});

describe("readConfigDirChoice", () => {
  it("reads the stored choice", () => {
    expect(readConfigDirChoice(fakeStorage(PERSO.path), AVAILABLE)).toBe(PERSO.path);
  });

  it("falls back to the default when storage throws", () => {
    const throwing: ChoiceStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(readConfigDirChoice(throwing, AVAILABLE)).toBe(DEFAULT.path);
  });
});

describe("writeConfigDirChoice", () => {
  it("stores the chosen path under the shared key", () => {
    const storage = fakeStorage();
    writeConfigDirChoice(storage, PERSO.path);
    expect(storage.value).toBe(PERSO.path);
    expect(NEW_SESSION_CONFIG_KEY).toBe("spexr.darkfactory.newSessionConfigDir");
  });

  it("swallows a storage failure", () => {
    const throwing: ChoiceStorage = {
      getItem: () => null,
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(() => writeConfigDirChoice(throwing, PERSO.path)).not.toThrow();
  });
});
