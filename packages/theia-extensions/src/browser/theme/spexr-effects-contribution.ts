import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { MessageService } from "@theia/core/lib/common/message-service";
import { PreferenceScope } from "@theia/core/lib/common/preferences/preference-scope";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { WindowService } from "@theia/core/lib/browser/window/window-service";
import { mount, mountGpu } from "@sondalab/ui-kit/effects.js";
import { SPEXR_EFFECTS_GPU_PREFERENCE } from "../preferences/spexr-preferences.js";
import { armEffectsWhenAllowed, gpuStep, webgpuSupported, type GpuLike } from "./effects-arming.js";

/**
 * Turns on the Sondalab effects layer: the glass material and lens on every
 * `.sl-fx-glass` host, and the aurora and pointer motion (Tier 1).
 *
 * One `mount(document)` covers the whole app: the kit observes the document
 * and dresses every glass host React adds later. Bound after
 * `SpexrThemeContribution`, so `data-sl-theme` is already set when it runs.
 * The WebGPU tier (Tier 2) follows `spexr.effects.gpu.enabled`, on by default;
 * on a machine without WebGPU the preference is switched off.
 */
@injectable()
export class SpexrEffectsContribution implements FrontendApplicationContribution {
  @inject(PreferenceService) private readonly preferences!: PreferenceService;
  @inject(MessageService) private readonly messages!: MessageService;
  @inject(WindowService) private readonly windowService!: WindowService;

  private mounted = false;
  private gpuRunning = false;

  onStart(): void {
    armEffectsWhenAllowed(
      document.documentElement,
      () => {
        this.mounted = mount(document);
        void this.preferences.ready.then(() => this.applyGpu());
      },
      (root, onChange) => {
        const observer = new MutationObserver(onChange);
        observer.observe(root as Element, { attributes: true, attributeFilter: ["data-sl-theme"] });
        return () => observer.disconnect();
      },
    );
    this.preferences.onPreferenceChanged((e) => {
      if (e.preferenceName === SPEXR_EFFECTS_GPU_PREFERENCE) void this.applyGpu();
    });
  }

  /** Bring the GPU tier in line with the preference; Tier 1 must be armed first. */
  private async applyGpu(): Promise<void> {
    if (!this.mounted) return;
    const wanted = this.preferences.get<boolean>(SPEXR_EFFECTS_GPU_PREFERENCE, true);
    const step = gpuStep(wanted, this.gpuRunning);
    if (step === "arm") {
      const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
      if (!(await webgpuSupported(gpu))) {
        // Written to the user scope so Settings shows the tier as off rather
        // than on-but-silently-absent; the change event lands on "none".
        await this.preferences.set(SPEXR_EFFECTS_GPU_PREFERENCE, false, PreferenceScope.User);
        return;
      }
      this.gpuRunning = await mountGpu();
      if (!this.gpuRunning) console.warn("[spexr] WebGPU glass unavailable; keeping the CSS glass");
    } else if (step === "reload") {
      const reload = "Reload";
      const answer = await this.messages.info("Turning the WebGPU glass off takes a window reload.", reload);
      if (answer === reload) this.windowService.reload();
    }
  }
}
