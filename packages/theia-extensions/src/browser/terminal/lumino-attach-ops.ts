import { UnsafeWidgetUtilities, Widget } from "@theia/core/lib/browser/widgets/widget";
import type { AttachOps } from "./terminal-attach.js";

/**
 * Real DOM operations for {@link attachWidget}/{@link detachWidget}. Attach is
 * the unchecked variant because hosts are React-owned divs, not the shell; park
 * reconnects a node to the body only for the length of a synchronous detach,
 * so it is never painted there.
 */
export const LUMINO_ATTACH_OPS: AttachOps<Widget, HTMLElement> = {
  attach: (widget, host) => UnsafeWidgetUtilities.attach(widget, host),
  detach: (widget) => Widget.detach(widget),
  park: (widget) => {
    document.body.appendChild(widget.node);
  },
};
