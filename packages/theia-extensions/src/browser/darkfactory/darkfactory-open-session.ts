import type { Command } from "@theia/core/lib/common/command";

/**
 * Open a session on the Darkfactory wall as an expanded card, the flow a click
 * on its tile takes: an idle session of this account resumes in a terminal in
 * the card, one that runs elsewhere opens a read-only follow with Fork. The
 * argument is the session id.
 */
export const DARKFACTORY_OPEN_SESSION_COMMAND: Command = {
  id: "spexr.darkfactory.openSession",
  category: "Darkfactory",
  label: "Open Session",
};

/** Show the Darkfactory wall (the Agents wall), in front: what the status bar's pill and the Sessions part's "N more" open. */
export const DARKFACTORY_OPEN_COMMAND: Command = {
  id: "spexr.darkfactory.open",
  category: "Darkfactory",
  label: "Open Agents Wall",
};
