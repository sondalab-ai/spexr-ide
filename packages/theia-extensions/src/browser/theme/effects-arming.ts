/** The slice of the document the arming reads: its root element's theme. */
export interface EffectsRoot {
  getAttribute(name: string): string | null;
}

/** Starts watching `root` for attribute changes; returns a stop function. */
export type WatchTheme = (root: EffectsRoot, onChange: () => void) => () => void;

/**
 * What to do with the WebGPU tier when the preference is read.
 *
 * The kit can arm the tier (`mountGpu`) but never disarm it, so turning it on
 * acts at once while turning it off can only be honoured by a reload.
 */
export function gpuStep(wanted: boolean, running: boolean): "arm" | "reload" | "none" {
  if (wanted && !running) return "arm";
  if (!wanted && running) return "reload";
  return "none";
}

/** The slice of `navigator.gpu` the support check reads. */
export interface GpuLike {
  requestAdapter(): Promise<unknown>;
}

/**
 * Whether this machine can run WebGPU at all: the API exists and hands out an
 * adapter. A present API with no adapter (blocklisted GPU, headless) counts
 * as unsupported, and so does an adapter request that throws.
 */
export async function webgpuSupported(gpu: GpuLike | undefined): Promise<boolean> {
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

/**
 * Arm the Sondalab effects layer once, as soon as the theme allows it.
 *
 * The kit's `mount()` refuses under high contrast, and it arms only once per
 * document, so a window that starts in high contrast would never get glass
 * after switching away. This defers the single call until the theme is one
 * the kit accepts. Switching *into* high contrast later is the kit's own job.
 */
export function armEffectsWhenAllowed(root: EffectsRoot, mount: () => void, watchTheme: WatchTheme): void {
  const allowed = (): boolean => root.getAttribute("data-sl-theme") !== "high-contrast";
  if (allowed()) {
    mount();
    return;
  }
  const stop = watchTheme(root, () => {
    if (!allowed()) return;
    stop();
    mount();
  });
}
