import { describe, expect, it, vi } from "vitest";
import { armEffectsWhenAllowed, gpuStep, webgpuSupported, type EffectsRoot } from "./effects-arming.js";

/** A root whose theme the test sets, with a watcher it can fire by hand. */
function fakeRoot(theme: string) {
  const state = { theme, listener: undefined as (() => void) | undefined, stopped: false };
  const root: EffectsRoot = { getAttribute: (n) => (n === "data-sl-theme" ? state.theme : null) };
  const watch = (_: EffectsRoot, onChange: () => void) => {
    state.listener = onChange;
    return () => {
      state.stopped = true;
    };
  };
  const setTheme = (t: string) => {
    state.theme = t;
    state.listener?.();
  };
  return { root, watch, setTheme, state };
}

describe("armEffectsWhenAllowed", () => {
  it("mounts right away on a theme the kit accepts", () => {
    const { root, watch, state } = fakeRoot("dark");
    const mount = vi.fn();
    armEffectsWhenAllowed(root, mount, watch);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(state.listener).toBeUndefined();
  });

  it("waits out high contrast, then mounts once and stops watching", () => {
    const { root, watch, setTheme, state } = fakeRoot("high-contrast");
    const mount = vi.fn();
    armEffectsWhenAllowed(root, mount, watch);
    expect(mount).not.toHaveBeenCalled();

    setTheme("high-contrast");
    expect(mount).not.toHaveBeenCalled();

    setTheme("light");
    expect(mount).toHaveBeenCalledTimes(1);
    expect(state.stopped).toBe(true);
  });
});

describe("gpuStep", () => {
  it("arms the tier when it is wanted and not running", () => {
    expect(gpuStep(true, false)).toBe("arm");
  });

  it("asks for a reload when it is running but no longer wanted", () => {
    expect(gpuStep(false, true)).toBe("reload");
  });

  it("does nothing when the preference already matches", () => {
    expect(gpuStep(true, true)).toBe("none");
    expect(gpuStep(false, false)).toBe("none");
  });
});

describe("webgpuSupported", () => {
  it("is false without the API", async () => {
    expect(await webgpuSupported(undefined)).toBe(false);
  });

  it("is false when no adapter is handed out", async () => {
    expect(await webgpuSupported({ requestAdapter: async () => null })).toBe(false);
  });

  it("is false when the adapter request throws", async () => {
    expect(await webgpuSupported({ requestAdapter: () => Promise.reject(new Error("lost")) })).toBe(false);
  });

  it("is true with an adapter", async () => {
    expect(await webgpuSupported({ requestAdapter: async () => ({}) })).toBe(true);
  });
});
