import { POWER_SAVE_LEAVE_PERCENT } from "../../common/power-protocol.js";

/** Set on `<html>` while SPEXR saves power; features and CSS key on it. */
export const POWER_SAVE_ATTRIBUTE = "data-spexr-power-save";

/** Marks a live-light host this module switched off, so only those are switched back. */
const SWITCHED_OFF = "data-spexr-fx-off";

const LIVE_HOSTS = "[data-sl-fx-live]";

/** Watches for live hosts that appear while saving; one per document. */
const watchers = new WeakMap<Document, MutationObserver>();

/** Whether SPEXR is saving power in this window. */
export function isPowerSaving(doc: Document = document): boolean {
  return doc.documentElement.hasAttribute(POWER_SAVE_ATTRIBUTE);
}

/**
 * Switch the page in or out of power saving.
 *
 * The root attribute drives our own features and the CSS that stills the
 * effects kit's paint (spexr.css). The kit itself is left armed, so content
 * mounted while saving is still dressed and looks right once power is back.
 * The one exception is the kit's live light, a WebGL loop CSS cannot stop:
 * its hosts get the kit's `data-sl-fx="off"` opt-out, including hosts that
 * appear while saving. The live light re-checks a host only when that host's
 * `data-sl-fx-live` changes, so each is rewritten to its current value.
 */
export function applyPowerSave(saving: boolean, doc: Document = document): void {
  doc.documentElement.toggleAttribute(POWER_SAVE_ATTRIBUTE, saving);
  watchers.get(doc)?.disconnect();
  watchers.delete(doc);
  if (saving) {
    for (const host of doc.querySelectorAll(LIVE_HOSTS)) switchOff(host);
    if (typeof MutationObserver === "function") {
      const watcher = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "attributes") switchOff(r.target as Element);
          else for (const n of r.addedNodes) if (n instanceof Element) switchOffWithin(n);
        }
      });
      watcher.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-sl-fx-live"] });
      watchers.set(doc, watcher);
    }
  } else {
    for (const host of doc.querySelectorAll(`[${SWITCHED_OFF}]`)) {
      host.removeAttribute(SWITCHED_OFF);
      host.removeAttribute("data-sl-fx");
      nudge(host);
    }
  }
}

function switchOffWithin(root: Element): void {
  if (root.matches(LIVE_HOSTS)) switchOff(root);
  for (const host of root.querySelectorAll(LIVE_HOSTS)) switchOff(host);
}

/** Opt a live host out, unless it already is (by us or by its own markup). */
function switchOff(host: Element): void {
  if (!host.hasAttribute("data-sl-fx-live") || host.hasAttribute("data-sl-fx")) return;
  host.setAttribute(SWITCHED_OFF, "");
  host.setAttribute("data-sl-fx", "off");
  nudge(host);
}

function nudge(host: Element): void {
  host.setAttribute("data-sl-fx-live", host.getAttribute("data-sl-fx-live") ?? "");
}

/** What the user is told when power saving starts or ends. */
export function powerSaveMessage(saving: boolean, level: number | undefined): string {
  if (!saving) return "Power is back: SPEXR has restored its animations, effects and background work.";
  const charge = level === undefined ? "Battery is low" : `Battery is at ${level}%`;
  return (
    `${charge}: SPEXR is saving power. Animations, visual effects, the Dark Factory rescan, ` +
    `background description generation and git auto-fetch are paused until you plug in or reach ${POWER_SAVE_LEAVE_PERCENT}%. ` +
    "Agents and anything you start keep running."
  );
}
