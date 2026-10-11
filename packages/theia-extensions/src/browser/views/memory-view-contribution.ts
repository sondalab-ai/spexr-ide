import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import type { SpexrMemoryWidget } from "./memory-widget.js";

export const MEMORY_VIEW_ID = "spexr.view.memory";

@injectable()
export class SpexrMemoryViewContribution extends AbstractViewContribution<SpexrMemoryWidget> {
  constructor() {
    super({
      widgetId: MEMORY_VIEW_ID,
      widgetName: nls.localize("spexr/memory/title", "Memory"),
      defaultWidgetOptions: {
        area: "right",
        rank: 1,
      },
      toggleCommandId: "spexr.view.memory.toggle",
      toggleKeybinding: "ctrlcmd+shift+m",
    });
  }
}
